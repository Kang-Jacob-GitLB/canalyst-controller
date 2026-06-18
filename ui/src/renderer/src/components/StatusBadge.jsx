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
  const isMock = status?.backend === 'mock'
  return (
    <div className="status-badge">
      <span className="dot" style={{ background: COLORS[connState] ?? '#999' }} />
      <span>{LABELS[connState] ?? connState}</span>
      {status && (
        <span className="device-state">
          {/* mock 백엔드는 가짜 트래픽이므로 실장비(canalystii)와 명확히 구분 */}
          {isMock ? (
            <span className="mock-badge" title="실제 장비가 아닌 가짜 CAN 트래픽입니다">
              데모 데이터(mock)
            </span>
          ) : (
            <>
              · <code>{status.backend}</code>
            </>
          )}
          {' · 장치 '}
          {status.connected ? '연결됨' : '미연결'}
        </span>
      )}
    </div>
  )
}
