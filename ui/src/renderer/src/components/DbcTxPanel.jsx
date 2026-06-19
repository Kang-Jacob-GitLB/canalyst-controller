import { useEffect, useState } from 'react'

// 신호 입력값(문자열)을 항상 완전한 숫자 dict 로 변환한다.
// 핵심: 입력 state 가 아니라 "선택된 메시지의 signal 목록"을 순회해 구성한다.
// → 누락 신호가 구조적으로 불가능해져 코어 인코딩 실패를 방지한다.
// minimum 이 0/음수(signed)일 수 있으므로 `|| 0` 이 아니라 `?? 0` 으로 기본값을 채운다.
function buildSignals(message, values) {
  return Object.fromEntries(
    message.signals.map((s) => [s.name, Number(values[s.name] ?? s.minimum ?? 0)])
  )
}

// 메시지의 모든 신호를 기본값(minimum ?? 0)으로 prefill 한 입력 state 를 만든다.
function defaultValues(message) {
  return Object.fromEntries(message.signals.map((s) => [s.name, s.minimum ?? 0]))
}

export default function DbcTxPanel({ dbcMessages, onListMessages, onEncodeSend, connected }) {
  const [channel, setChannel] = useState(0)
  const [selectedName, setSelectedName] = useState('')
  const [values, setValues] = useState({}) // {신호명: 입력문자열|숫자}
  const [sent, setSent] = useState(null) // 마지막 송신 피드백(일시적)

  const selected = dbcMessages.find((m) => m.name === selectedName) || null

  // 선택된 메시지가 바뀌거나 목록이 갱신되면 그 메시지의 신호로 입력 필드를 다시 prefill 한다.
  useEffect(() => {
    const msg = dbcMessages.find((m) => m.name === selectedName)
    setValues(msg ? defaultValues(msg) : {})
  }, [selectedName, dbcMessages])

  function submit(e) {
    e.preventDefault()
    if (!selected) return
    const signals = buildSignals(selected, values)
    onEncodeSend(selected.name, signals, channel)
    setSent({ name: selected.name, at: new Date().toLocaleTimeString() })
  }

  const loaded = dbcMessages.length > 0
  const canSend = connected && !!selectedName && loaded

  return (
    <form className="tx-panel" onSubmit={submit}>
      <div className="panel-header">
        <h2>DBC 송신</h2>
      </div>

      <div className="tx-row">
        <label>
          CH
          <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </label>
        <button type="button" onClick={onListMessages}>
          DBC 메시지 새로고침
        </button>
      </div>

      <div className="tx-row">
        <label className="grow">
          메시지
          <select value={selectedName} onChange={(e) => setSelectedName(e.target.value)}>
            <option value="">— 메시지 선택 —</option>
            {dbcMessages.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} (0x{Number(m.frame_id).toString(16).toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected && (
        <div className="dbc-signals">
          {selected.signals.length === 0 && (
            <p className="tx-hint">이 메시지에는 신호가 없습니다.</p>
          )}
          {selected.signals.map((s) => (
            <div className="tx-row" key={s.name}>
              <label className="grow">
                {s.name}
                <input
                  type="number"
                  value={values[s.name] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [s.name]: e.target.value }))}
                />
              </label>
              <span className="mono dbc-range">
                {s.unit ? `${s.unit} ` : ''}
                {`[${s.minimum ?? '?'}..${s.maximum ?? '?'}]`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="tx-row">
        <button type="submit" className="btn-primary" disabled={!canSend}>
          인코딩 송신
        </button>
      </div>

      {sent && (
        <p className="tx-sent">
          송신됨: {sent.name} @ {sent.at} (송수신 모니터의 TX 행으로 확인)
        </p>
      )}
      {!loaded && (
        <p className="tx-hint">
          먼저 도구 패널에서 DBC 파일을 로드한 뒤 "DBC 메시지 새로고침"을 누르세요.
        </p>
      )}
      {!connected && <p className="tx-hint">연결 후 송신할 수 있습니다.</p>}
    </form>
  )
}
