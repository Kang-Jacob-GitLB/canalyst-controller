import { useEffect, useState } from 'react'

export default function App() {
  const [wsState, setWsState] = useState('연결 중…')
  const [status, setStatus] = useState(null)

  useEffect(() => {
    const url = window.canctl?.coreUrl ?? 'ws://127.0.0.1:8765'
    const ws = new WebSocket(url)
    ws.onopen = () => setWsState('코어 연결됨')
    ws.onclose = () => setWsState('코어 연결 끊김')
    ws.onerror = () => setWsState('코어 연결 오류')
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'status') setStatus(msg)
    }
    return () => ws.close()
  }, [])

  return (
    <div className="app">
      <h1>CANalyst-II Controller</h1>
      <p className="core-state">
        코어 상태: <strong>{wsState}</strong>
      </p>
      {status && (
        <p>
          백엔드: <code>{status.backend}</code> · 장치 연결:{' '}
          {status.connected ? '예' : '아니오'}
        </p>
      )}
    </div>
  )
}
