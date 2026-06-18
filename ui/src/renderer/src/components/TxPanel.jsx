import { useState } from 'react'

export default function TxPanel({ status, onSend }) {
  const [canId, setCanId] = useState('123')
  const [channel, setChannel] = useState(0)
  const [extended, setExtended] = useState(false)
  const [rtr, setRtr] = useState(false)
  const [dataStr, setDataStr] = useState('11 22 33')
  const [err, setErr] = useState(null)
  const connected = !!status?.connected

  function submit(e) {
    e.preventDefault()
    setErr(null)

    const id = parseInt(canId, 16)
    if (Number.isNaN(id) || id < 0) {
      setErr('CAN ID는 16진수여야 합니다 (예: 123, 1AB)')
      return
    }

    const bytes =
      dataStr.trim() === '' ? [] : dataStr.trim().split(/\s+/).map((t) => parseInt(t, 16))
    if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      setErr('데이터는 00..FF 16진수 바이트를 공백으로 구분해 입력하세요')
      return
    }
    if (bytes.length > 8) {
      setErr('데이터는 최대 8바이트입니다')
      return
    }

    onSend({ channel, can_id: id, extended, rtr, data: rtr ? [] : bytes })
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

      {err && <p className="tx-err">{err}</p>}
      {!connected && <p className="tx-hint">연결 후 송신할 수 있습니다.</p>}
    </form>
  )
}
