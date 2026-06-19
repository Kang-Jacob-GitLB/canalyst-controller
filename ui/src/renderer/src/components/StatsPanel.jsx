// 수신 통계 패널: 누적 총 프레임 수, 고유 ID 수, 초당 메시지(msg/s),
// ID별 누적 카운트를 표시한다. 통계는 useCanSocket 의 누적 stats 를 소비하며
// frames(500개 캡)와 무관하게 전체 기간을 집계한다.

// can_id 를 0x 접두 16진수로 표시(표준 3자리/확장 8자리 자동 판별).
// 0x7FF 초과면 확장 ID 로 간주해 8자리로 패딩한다.
function fmtId(id) {
  const extended = id > 0x7ff
  return '0x' + id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
}

export default function StatsPanel({ stats, onReset }) {
  const { total, byId, rate } = stats
  const ids = Object.keys(byId)
  const uniqueIds = ids.length

  // ID별 카운트 내림차순 정렬(동률이면 ID 오름차순). 표시는 상위 일부로 제한.
  const sorted = ids
    .map((k) => [Number(k), byId[k]])
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])

  return (
    <section className="stats-panel">
      <div className="panel-header">
        <h2>수신 통계</h2>
        <button onClick={onReset}>통계 초기화</button>
      </div>

      <div className="stats-metrics">
        <div>
          <div className="stat-label">총 프레임</div>
          <div className="stat-value">{total}</div>
        </div>
        <div>
          <div className="stat-label">고유 ID</div>
          <div className="stat-value">{uniqueIds}</div>
        </div>
        <div>
          <div className="stat-label">수신 레이트</div>
          <div className="stat-value accent">{rate.toFixed(0)} msg/s</div>
        </div>
      </div>

      {uniqueIds > 0 && (
        <div className="stats-byid">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th className="num">카운트</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([id, count]) => (
                <tr key={id}>
                  <td className="mono">{fmtId(id)}</td>
                  <td className="mono num">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
