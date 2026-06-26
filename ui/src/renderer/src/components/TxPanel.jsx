import { useEffect, useRef, useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'

// 주기 송신 기본값(ms)과 하한. 너무 짧으면 코어/버스가 폭주하므로 10ms로 막는다.
const DEFAULT_PERIOD_MS = 1000
const MIN_PERIOD_MS = 10

// 프리셋 1개를 표준 형태로 정규화한다. 채널은 더 이상 프리셋에 포함하지 않으므로
// (현재 폼 채널로 전송) 저장·가져오기 시 channel 키를 떨어뜨려 영속 데이터를 깔끔히 한다.
// 과거 버전이 channel 을 포함해 저장/내보냈더라도 이걸 거치면 통일된 형태가 된다.
function normalizePreset(p) {
  return { name: p.name, canId: p.canId, extended: p.extended, rtr: p.rtr, dataStr: p.dataStr }
}

// 폼 원시값(canId 문자열 등)을 검증해 송신 프레임으로 변환한다.
// 성공 시 { frame }, 실패 시 { error }. 폼 제출·주기 틱·프리셋 재전송이 공유한다.
function buildFrame({ canId, channel, extended, rtr, dataStr }) {
  const id = parseInt(canId, 16)
  if (Number.isNaN(id) || id < 0) {
    return { error: 'CAN ID는 16진수여야 합니다 (예: 123, 1AB)' }
  }

  const bytes = dataStr.trim() === '' ? [] : dataStr.trim().split(/\s+/).map((t) => parseInt(t, 16))
  if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    return { error: '데이터는 00..FF 16진수 바이트를 공백으로 구분해 입력하세요' }
  }
  if (bytes.length > 8) {
    return { error: '데이터는 최대 8바이트입니다' }
  }

  return { frame: { channel, can_id: id, extended, rtr, data: rtr ? [] : bytes } }
}

// 배열에서 from 위치 항목을 to 위치로 옮긴 새 배열을 만든다(프리셋 드래그 재정렬용).
// 범위 밖/동일 위치면 원본을 그대로 반환해 불필요한 상태 갱신을 피한다.
function moveItem(arr, from, to) {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// 프리셋 행 액션용 라인 아이콘(Feather 계열). 컬러 이모지 대신 모노톤 SVG 를 써서
// 다크 테마에서 currentColor(=버튼 텍스트색, 흰색계)로 렌더된다 — 배경과 충돌하지 않고
// baseline 정렬이 안정적이다. 의미는 버튼의 aria-label/title 이 전달하므로 aria-hidden.
function ActionIcon({ children }) {
  return (
    <svg
      className="tx-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// 각 동작의 아이콘 path 조각. 로드=내려받기(폼으로 가져오기), 이름 변경=연필,
// 덮어쓰기=디스크 저장, 재전송=종이비행기(보내기), 삭제=휴지통.
const ICON_LOAD = (
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>
)
const ICON_RENAME = <path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
const ICON_OVERWRITE = (
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </>
)
const ICON_SEND = (
  <>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </>
)
const ICON_DELETE = (
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </>
)

// 프리셋 이름 아래 서브 텍스트로 보여줄 한 줄 요약: CAN ID · (확장) · (RTR|데이터).
// hex 값이라 모노폰트로 표시한다(CSS). RTR 은 데이터가 없으므로 'RTR' 로 표기한다.
function presetDetail(p) {
  const parts = [`ID ${p.canId}`]
  if (p.extended) parts.push('EXT')
  parts.push(p.rtr ? 'RTR' : p.dataStr.trim() || '데이터 없음')
  return parts.join(' · ')
}

export default function TxPanel({ status, onSend, prefill }) {
  const [canId, setCanId] = usePersistentState('canctl.tx.canId', '123')
  const [channel, setChannel] = usePersistentState('canctl.tx.channel', 0)
  const [extended, setExtended] = usePersistentState('canctl.tx.extended', false)
  const [rtr, setRtr] = usePersistentState('canctl.tx.rtr', false)
  const [dataStr, setDataStr] = usePersistentState('canctl.tx.dataStr', '11 22 33')
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(null) // 마지막 송신 피드백(일시적)

  // 주기 송신 상태
  const [periodic, setPeriodic] = usePersistentState('canctl.tx.periodic', false)
  const [periodStr, setPeriodStr] = usePersistentState('canctl.tx.periodMs', String(DEFAULT_PERIOD_MS))

  // 송신 프리셋: 폼 원시값 묶음을 이름과 함께 저장(localStorage 영속).
  // 채널은 프리셋에 포함하지 않는다 — 전송 시 항상 "현재 송신 채널"(아래 channel)을 쓴다.
  const [presets, setPresets] = usePersistentState('canctl.tx.presets', [])
  const [presetName, setPresetName] = useState('')
  const fileInputRef = useRef(null) // 프리셋 가져오기용 숨김 file input

  // 과거 버전이 channel 을 포함해 저장한 프리셋을 초기 1회 정규화(channel 키 제거).
  // 안 하면 그런 프리셋을 내보낼 때 channel 이 다시 섞여 나간다. 이미 정규화돼 있으면 no-op.
  const normalizedOnceRef = useRef(false)
  useEffect(() => {
    if (normalizedOnceRef.current) return
    normalizedOnceRef.current = true
    setPresets((prev) =>
      prev.some((p) => 'channel' in p) ? prev.map(normalizePreset) : prev
    )
  }, [setPresets])

  // 프리셋 드래그 재정렬 상태: dragIndex=끌고 있는 항목, overIndex=현재 올라가 있는 대상.
  // 로직은 dragIndex 로, 시각 강조는 두 값으로 처리한다(라이브러리 없이 네이티브 HTML5 DnD).
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  // 프리셋 덮어쓰기/전체교체는 되돌릴 수 없으므로 인라인 확인 단계를 거친다.
  // pending=null 이면 확인 대기 없음. 판별 유니온:
  //  - { kind:'overwrite', name, fromSave } : 기존 프리셋 1개를 현재 폼 값으로 덮어쓰기
  //    (fromSave=true 면 저장 폼에서 시작 → 확인 후 이름 입력칸 비우기)
  //  - { kind:'replaceImport', presets:[..] } : 기존 목록 전체를 가져온 것으로 교체
  const [pending, setPending] = useState(null)

  // 프리셋 가져오기 병합 방식. 파괴적 기본값을 피하려 영속하지 않고 세션마다 병합으로 시작한다.
  const [importMode, setImportMode] = useState('merge') // 'merge' | 'replace'

  // 프리셋 이름 인라인 편집 상태. renamingName=편집 중인 프리셋의 현재 이름(없으면 null),
  // renameValue=input 의 현재 값. 이름은 프리셋의 식별자(key)라 커밋 시 빈값·중복을 막는다.
  const [renamingName, setRenamingName] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const connected = !!status?.connected

  // 현재 폼으로 프레임을 만들어 송신한다. 검증 실패 시 false 반환(틱은 skip).
  function sendCurrent() {
    const { frame, error } = buildFrame({ canId, channel, extended, rtr, dataStr })
    if (error) {
      setErr(error)
      return false
    }
    setErr(null)
    onSend(frame)
    setSent({
      id: '0x' + frame.can_id.toString(16).toUpperCase(),
      at: new Date().toLocaleTimeString()
    })
    return true
  }

  // 프리셋 객체에서 직접 프레임을 만들어 송신한다(폼 state 경유 금지 — stale 방지).
  // 채널만은 프리셋이 아니라 "현재 송신 채널"(폼 channel)을 쓴다 — 프리셋은 채널에 비종속.
  function sendPreset(p) {
    const { frame, error } = buildFrame({ ...p, channel })
    if (error) {
      setErr(error)
      return
    }
    setErr(null)
    onSend(frame)
    setSent({
      id: '0x' + frame.can_id.toString(16).toUpperCase(),
      at: new Date().toLocaleTimeString()
    })
  }

  function submit(e) {
    e.preventDefault()
    sendCurrent()
  }

  // 주기 송신: 최신 송신 동작을 ref에 담아 interval이 stale closure를 읽지 않게 한다.
  // (form 값을 deps에 넣으면 키 입력마다 interval이 재생성돼 주기가 리셋된다.)
  const tickRef = useRef(sendCurrent)
  tickRef.current = sendCurrent

  const periodMs = Math.max(MIN_PERIOD_MS, Number(periodStr) || DEFAULT_PERIOD_MS)
  const running = periodic && connected

  useEffect(() => {
    // 미연결이면 interval을 만들지 않으므로 "미연결 송신 금지"가 자동 충족된다.
    // 토글 해제/언마운트/연결 해제 시 cleanup이 interval을 제거한다.
    if (!periodic || !connected) return
    const t = setInterval(() => {
      tickRef.current()
    }, periodMs)
    return () => clearInterval(t)
  }, [periodic, connected, periodMs])

  // 모니터 행 더블클릭 등으로 외부에서 폼을 채운다(prefill). 새 prefill 객체가
  // 올 때만 폼 필드를 덮어쓴다. 참조 동등성이 같은 객체의 재적용을 막으므로
  // 별도 식별자 추적은 필요 없다. prefill 이 없을 때(초기 마운트 포함)는 아무것도
  // 하지 않아 usePersistentState 로 복원된 기본값을 지우지 않는다.
  useEffect(() => {
    if (!prefill) return
    setCanId(prefill.canId)
    setChannel(prefill.channel)
    setExtended(prefill.extended)
    setRtr(prefill.rtr)
    setDataStr(prefill.dataStr)
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // 현재 폼 원시값을 name 으로 프리셋에 기록한다. 같은 이름이 있으면 위치를 유지한 채
  // 교체(map), 없으면 끝에 추가. 저장·행 덮어쓰기가 공유한다.
  // channel 은 일부러 제외한다 — 전송 시 현재 송신 채널을 쓰므로 프리셋엔 담지 않는다.
  function writePreset(name) {
    const entry = { name, canId, extended, rtr, dataStr }
    setPresets((prev) =>
      prev.some((p) => p.name === name)
        ? prev.map((p) => (p.name === name ? entry : p))
        : [...prev, entry]
    )
  }

  // 현재 폼 원시값을 이름 붙여 프리셋으로 저장한다. 같은 이름이 이미 있으면
  // 곧바로 덮어쓰지 않고 확인 단계로 넘긴다(실수 방지).
  function savePreset() {
    const name = presetName.trim()
    if (name === '') {
      setErr('프리셋 이름을 입력하세요')
      return
    }
    setErr(null)
    if (presets.some((p) => p.name === name)) {
      setPending({ kind: 'overwrite', name, fromSave: true })
      return
    }
    writePreset(name)
    setPresetName('')
  }

  // 목록의 특정 프리셋을 현재 폼 값으로 덮어쓰기 — 확인 단계를 거친다.
  function overwritePreset(name) {
    setErr(null)
    setPending({ kind: 'overwrite', name, fromSave: false })
  }

  // 확인 배너의 "확인" — 대기 중인 덮어쓰기/전체교체를 실제로 수행한다.
  function confirmPending() {
    if (!pending) return
    if (pending.kind === 'overwrite') {
      writePreset(pending.name)
      if (pending.fromSave) setPresetName('')
    } else if (pending.kind === 'replaceImport') {
      setPresets(pending.presets)
    }
    setPending(null)
  }

  // 프리셋을 폼에 로드(표시용 setter 호출). 송신은 별도 경로(sendPreset).
  // 채널은 프리셋에 없으므로 건드리지 않는다 — 현재 송신 채널을 그대로 유지한다.
  function loadPreset(p) {
    setCanId(p.canId)
    setExtended(p.extended)
    setRtr(p.rtr)
    setDataStr(p.dataStr)
    setErr(null)
  }

  function deletePreset(name) {
    setPresets((prev) => prev.filter((p) => p.name !== name))
    // 덮어쓰기 확인 대기 중인 대상이 삭제되면 확인 단계도 취소한다.
    setPending((cur) => (cur?.kind === 'overwrite' && cur.name === name ? null : cur))
  }

  // 프리셋 이름 인라인 편집 시작 — 현재 이름을 input 초기값으로 채운다.
  function startRename(p) {
    setRenamingName(p.name)
    setRenameValue(p.name)
    setErr(null)
  }

  // 인라인 편집 취소(Esc/blur) — 아무것도 바꾸지 않고 닫는다.
  function cancelRename() {
    setRenamingName(null)
  }

  // 인라인 편집 커밋(Enter). 이름은 프리셋의 식별자라 빈값·중복을 막는다:
  //  - 빈 이름: 저장 규칙과 동일하게 거부(편집 유지)
  //  - 변경 없음: 그냥 닫기(no-op)
  //  - 다른 프리셋과 중복: 거부 — 두 프리셋을 합치지 않는다(사용자가 기대하지 않음)
  // 성공 시 해당 항목의 name 만 교체하고, pending(덮어쓰기 확인)이 옛 이름을
  // 가리키면 새 이름으로 따라가게 해 정합을 유지한다.
  function commitRename() {
    if (renamingName === null) return
    const oldName = renamingName
    const next = renameValue.trim()
    if (next === '') {
      setErr('프리셋 이름을 입력하세요')
      return
    }
    if (next === oldName) {
      setRenamingName(null) // 변경 없음
      return
    }
    if (presets.some((p) => p.name === next)) {
      setErr(`'${next}' 프리셋이 이미 있습니다`)
      return
    }
    setErr(null)
    setPresets((prev) => prev.map((p) => (p.name === oldName ? { ...p, name: next } : p)))
    setPending((cur) =>
      cur?.kind === 'overwrite' && cur.name === oldName ? { ...cur, name: next } : cur
    )
    setRenamingName(null)
  }

  // 프리셋 행 드래그 재정렬(네이티브 HTML5 DnD). 핸들(⠿)에서 드래그를 시작하고
  // 각 행(li)이 드롭 대상이다. dataTransfer 는 jsdom 에 없을 수 있어 접근을 try 로 감싼다.
  function handleDragStart(e, i) {
    setDragIndex(i)
    try { e.dataTransfer.effectAllowed = 'move' } catch { /* jsdom: dataTransfer 없음 */ }
  }
  function handleDragOver(e, i) {
    e.preventDefault() // 드롭을 허용하려면 dragover 기본동작을 막아야 한다
    try { e.dataTransfer.dropEffect = 'move' } catch { /* noop */ }
    if (overIndex !== i) setOverIndex(i)
  }
  function handleDrop(e, i) {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== i) {
      setPresets((prev) => moveItem(prev, dragIndex, i))
    }
    setDragIndex(null)
    setOverIndex(null)
  }
  function handleDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  // 프리셋 1개가 올바른 구조({name, canId, extended, rtr, dataStr})인지 검증.
  // channel 은 더 이상 프리셋에 포함하지 않으므로 검사하지 않는다(과거 파일 호환).
  // 가져오기에서 잘못된 파일을 거르는 데 쓴다.
  function isValidPreset(p) {
    return (
      p &&
      typeof p === 'object' &&
      typeof p.name === 'string' &&
      typeof p.canId === 'string' &&
      typeof p.extended === 'boolean' &&
      typeof p.rtr === 'boolean' &&
      typeof p.dataStr === 'string'
    )
  }

  // 현재 프리셋 배열을 JSON 파일로 내보낸다(Blob + 숨김 <a download> 클릭).
  function exportPresets() {
    const json = JSON.stringify(presets, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'presets.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 숨김 file input 의 변경 이벤트: 선택한 JSON 파일을 읽어 프리셋 배열을 검증한다.
  // importMode 에 따라:
  //  - 'merge'   : 기존 목록에 병합(동일 이름은 가져온 값으로 덮어쓰기)
  //  - 'replace' : 기존 목록을 전부 지우고 가져온 것으로 교체. 잃을 프리셋이 있으면
  //                확인 단계를 거치고, 비어 있으면 곧바로 교체한다.
  // 파싱 실패·형식 오류는 오류 메시지로 표시한다.
  function importPresets(e) {
    const file = e.target.files && e.target.files[0]
    // 같은 파일을 다시 선택해도 change 가 발생하도록 input 값을 비운다.
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (!Array.isArray(parsed) || !parsed.every(isValidPreset)) {
          setErr('프리셋 파일 형식이 올바르지 않습니다')
          return
        }
        setErr(null)
        // 과거 파일이 channel 을 포함해도 정규화로 떨어뜨려 저장 형태를 통일한다.
        const incoming = parsed.map(normalizePreset)
        if (importMode === 'replace') {
          if (presets.length === 0) {
            setPresets(incoming) // 잃을 게 없으면 확인 없이 교체
          } else {
            setPending({ kind: 'replaceImport', presets: incoming })
          }
        } else {
          setPresets((prev) => {
            const names = new Set(incoming.map((p) => p.name))
            const kept = prev.filter((p) => !names.has(p.name)) // 동일 이름은 가져온 값으로 대체
            return [...kept, ...incoming]
          })
        }
      } catch {
        setErr('프리셋 파일을 읽을 수 없습니다 (JSON 파싱 오류)')
      }
    }
    reader.onerror = () => setErr('프리셋 파일을 읽을 수 없습니다')
    reader.readAsText(file)
  }

  return (
    <form className="tx-panel" onSubmit={submit}>
      <div className="panel-header">
        <h2>프레임 송신</h2>
      </div>

      {/* 송신 채널: 프레임별 속성(ID/EXT/RTR)이 아니라 모든 송신에 공통 적용되는 "현재 채널"이라
          전용 행으로 분리한다. 수동 송신·주기 송신·프리셋 전송이 모두 이 채널을 쓴다. */}
      <div className="tx-row">
        <label>
          송신 채널(CH)
          <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </label>
        <span className="tx-hint">송신·주기·프리셋 전송에 공통 적용</span>
      </div>

      <div className="tx-row">
        <label>
          ID(hex)
          <input value={canId} onChange={(e) => setCanId(e.target.value)} size={8} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} />
          확장(EXT)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={rtr} onChange={(e) => setRtr(e.target.checked)} />
          RTR
        </label>
      </div>

      <div className="tx-row">
        <label className="grow">
          데이터(hex)
          <input
            value={dataStr}
            onChange={(e) => setDataStr(e.target.value)}
            disabled={rtr}
            placeholder="11 22 33"
          />
        </label>
        <button type="submit" className="btn-primary" disabled={!connected}>
          송신
        </button>
      </div>

      {/* 주기 송신: 토글 + 주기(ms). 켜져 있고 연결된 동안 현재 폼 프레임을 반복 송신 */}
      <div className="tx-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={periodic}
            onChange={(e) => setPeriodic(e.target.checked)}
          />
          주기 송신
        </label>
        <label>
          주기(ms)
          <input
            value={periodStr}
            onChange={(e) => setPeriodStr(e.target.value)}
            size={6}
            inputMode="numeric"
          />
        </label>
        {running && (
          <span className="tools-state" role="status">
            주기 송신 중 ({periodMs}ms)
          </span>
        )}
      </div>

      {/* 송신 프리셋: 현재 폼을 이름 붙여 저장 / 로드 / 재전송 / 삭제 / import·export */}
      <div className="tx-row">
        <label className="grow">
          프리셋 이름
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="엔진 RPM 요청"
          />
        </label>
        <button type="button" onClick={savePreset}>
          프리셋 저장
        </button>
      </div>

      {/* 프리셋 묶음 import/export: 내보내기는 즉시 다운로드, 가져오기는 숨김 file input 트리거.
          가져오기 방식(병합/전체 덮어쓰기)을 라디오로 고른다. */}
      <div className="tx-row">
        <button type="button" onClick={exportPresets} disabled={presets.length === 0}>
          프리셋 내보내기
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          프리셋 가져오기
        </button>
        <label className="checkbox">
          <input
            type="radio"
            name="presetImportMode"
            checked={importMode === 'merge'}
            onChange={() => setImportMode('merge')}
          />
          병합
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="presetImportMode"
            checked={importMode === 'replace'}
            onChange={() => setImportMode('replace')}
          />
          전체 덮어쓰기
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={importPresets}
          style={{ display: 'none' }}
        />
      </div>

      {/* 덮어쓰기/전체교체 확인 배너: 되돌릴 수 없는 작업 직전에 확인을 받는다. */}
      {pending && (
        <div className="tx-confirm" role="alertdialog" aria-label="프리셋 덮어쓰기 확인">
          <span className="tx-confirm-msg">
            {pending.kind === 'replaceImport'
              ? `기존 프리셋 ${presets.length}개를 모두 지우고 가져온 ${pending.presets.length}개로 교체할까요?`
              : `'${pending.name}' 프리셋을 현재 폼 값으로 덮어쓸까요?`}
          </span>
          <span className="tx-confirm-actions">
            <button type="button" className="btn-danger" onClick={confirmPending}>
              확인
            </button>
            <button type="button" onClick={() => setPending(null)}>
              취소
            </button>
          </span>
        </div>
      )}

      {presets.length > 0 && (
        <ul className="tx-presets">
          {presets.map((p, i) => (
            <li
              key={p.name}
              className={
                'tx-preset' +
                (dragIndex === i ? ' dragging' : '') +
                (overIndex === i && dragIndex !== i ? ' drag-over' : '')
              }
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
            >
              <div className="tx-preset-head">
                {/* 드래그 핸들: 여기서만 드래그가 시작돼 버튼 클릭과 충돌하지 않는다. */}
                <span
                  className="tx-preset-drag"
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragEnd={handleDragEnd}
                  role="button"
                  aria-label={`${p.name} 순서 변경 핸들`}
                  title="드래그하여 순서 변경"
                >
                  ⠿
                </span>
                {renamingName === p.name ? (
                  <input
                    className="tx-preset-rename"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                    onBlur={cancelRename}
                    aria-label={`${p.name} 이름 변경`}
                    autoFocus
                  />
                ) : (
                  <span className="tx-preset-meta">
                    <span className="tx-preset-name" title={`ID ${p.canId} ${p.dataStr}`}>
                      {p.name}
                    </span>
                    <span className="tx-preset-detail">{presetDetail(p)}</span>
                  </span>
                )}
              </div>
              <span className="tx-preset-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="로드"
                  title="폼으로 불러오기"
                  onClick={() => loadPreset(p)}
                >
                  <ActionIcon>{ICON_LOAD}</ActionIcon>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="이름 변경"
                  title="이름 변경"
                  onClick={() => startRename(p)}
                >
                  <ActionIcon>{ICON_RENAME}</ActionIcon>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="덮어쓰기"
                  title="현재 폼 값으로 덮어쓰기"
                  onClick={() => overwritePreset(p.name)}
                >
                  <ActionIcon>{ICON_OVERWRITE}</ActionIcon>
                </button>
                <button
                  type="button"
                  className="icon-btn btn-primary"
                  aria-label="재전송"
                  title="이 프리셋 재전송"
                  onClick={() => sendPreset(p)}
                  disabled={!connected}
                >
                  <ActionIcon>{ICON_SEND}</ActionIcon>
                </button>
                <button
                  type="button"
                  className="icon-btn icon-danger"
                  aria-label="삭제"
                  title="삭제"
                  onClick={() => deletePreset(p.name)}
                >
                  <ActionIcon>{ICON_DELETE}</ActionIcon>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="tx-err">{err}</p>}
      {sent && !err && (
        <p className="tx-sent">송신됨: {sent.id} @ {sent.at} (송수신 모니터의 TX 행으로 확인)</p>
      )}
      {!connected && <p className="tx-hint">연결 후 송신할 수 있습니다.</p>}
    </form>
  )
}
