import { useEffect, useRef, useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'

// 주기 송신 기본값(ms)과 하한. 너무 짧으면 코어/버스가 폭주하므로 10ms로 막는다.
const DEFAULT_PERIOD_MS = 1000
const MIN_PERIOD_MS = 10

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

  // 송신 프리셋: 폼 원시값 묶음을 이름과 함께 저장(localStorage 영속)
  const [presets, setPresets] = usePersistentState('canctl.tx.presets', [])
  const [presetName, setPresetName] = useState('')
  const fileInputRef = useRef(null) // 프리셋 가져오기용 숨김 file input

  // 프리셋 덮어쓰기/전체교체는 되돌릴 수 없으므로 인라인 확인 단계를 거친다.
  // pending=null 이면 확인 대기 없음. 판별 유니온:
  //  - { kind:'overwrite', name, fromSave } : 기존 프리셋 1개를 현재 폼 값으로 덮어쓰기
  //    (fromSave=true 면 저장 폼에서 시작 → 확인 후 이름 입력칸 비우기)
  //  - { kind:'replaceImport', presets:[..] } : 기존 목록 전체를 가져온 것으로 교체
  const [pending, setPending] = useState(null)

  // 프리셋 가져오기 병합 방식. 파괴적 기본값을 피하려 영속하지 않고 세션마다 병합으로 시작한다.
  const [importMode, setImportMode] = useState('merge') // 'merge' | 'replace'

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
  function sendPreset(p) {
    const { frame, error } = buildFrame(p)
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
  function writePreset(name) {
    const entry = { name, canId, channel, extended, rtr, dataStr }
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
  function loadPreset(p) {
    setCanId(p.canId)
    setChannel(p.channel)
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

  // 프리셋 1개가 올바른 구조({name, canId, channel, extended, rtr, dataStr})인지 검증.
  // 가져오기에서 잘못된 파일을 거르는 데 쓴다.
  function isValidPreset(p) {
    return (
      p &&
      typeof p === 'object' &&
      typeof p.name === 'string' &&
      typeof p.canId === 'string' &&
      typeof p.channel === 'number' &&
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
        if (importMode === 'replace') {
          if (presets.length === 0) {
            setPresets(parsed) // 잃을 게 없으면 확인 없이 교체
          } else {
            setPending({ kind: 'replaceImport', presets: parsed })
          }
        } else {
          setPresets((prev) => {
            const names = new Set(parsed.map((p) => p.name))
            const kept = prev.filter((p) => !names.has(p.name)) // 동일 이름은 가져온 값으로 대체
            return [...kept, ...parsed]
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

      <div className="tx-row">
        <label>
          CH
          <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </label>
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
          {presets.map((p) => (
            <li key={p.name} className="tx-preset">
              <span className="tx-preset-name" title={`CH${p.channel} ID ${p.canId} ${p.dataStr}`}>
                {p.name}
              </span>
              <span className="tx-preset-actions">
                <button type="button" onClick={() => loadPreset(p)}>
                  로드
                </button>
                <button type="button" onClick={() => overwritePreset(p.name)}>
                  덮어쓰기
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => sendPreset(p)}
                  disabled={!connected}
                >
                  재전송
                </button>
                <button type="button" className="btn-danger" onClick={() => deletePreset(p.name)}>
                  삭제
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
