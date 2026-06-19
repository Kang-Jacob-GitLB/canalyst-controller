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

export default function TxPanel({ status, onSend }) {
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

  // 현재 폼 원시값을 이름 붙여 프리셋으로 저장한다(동일 이름은 덮어쓴다).
  function savePreset() {
    const name = presetName.trim()
    if (name === '') {
      setErr('프리셋 이름을 입력하세요')
      return
    }
    setErr(null)
    const entry = { name, canId, channel, extended, rtr, dataStr }
    setPresets((prev) => {
      const rest = prev.filter((p) => p.name !== name)
      return [...rest, entry]
    })
    setPresetName('')
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

      {/* 송신 프리셋: 현재 폼을 이름 붙여 저장 / 로드 / 재전송 / 삭제 */}
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

      {presets.length > 0 && (
        <ul className="tx-presets" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {presets.map((p) => (
            <li
              key={p.name}
              className="tx-row"
              style={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span className="mono" title={`CH${p.channel} ID ${p.canId} ${p.dataStr}`}>
                {p.name}
              </span>
              <span className="tx-row" style={{ gap: 6 }}>
                <button type="button" onClick={() => loadPreset(p)}>
                  로드
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
