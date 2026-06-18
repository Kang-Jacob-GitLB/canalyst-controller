const LABELS = {
  connecting: '코어 연결 중…',
  open: '코어 연결됨',
  closed: '코어 끊김',
  error: '코어 오류'
}

const COLORS = {
  open: '#4caf50',
  error: '#f44336',
  closed: '#ff9800',
  connecting: '#999'
}

export default function StatusBadge({ connState, status }) {
  return (
    <div className="status-badge">
      <span className="dot" style={{ background: COLORS[connState] ?? '#999' }} />
      <span>{LABELS[connState] ?? connState}</span>
      {status && (
        <span className="device-state">
          · <code>{status.backend}</code> · 장치 {status.connected ? '연결됨' : '미연결'}
        </span>
      )}
    </div>
  )
}
