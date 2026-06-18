function fmtData(data) {
  return data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function fmtId(id, extended) {
  return '0x' + id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
}

export default function RxMonitor({ frames, onClear }) {
  const rows = frames.slice().reverse() // 최신이 위로

  return (
    <section className="rx-monitor">
      <div className="panel-header">
        <h2>수신 모니터 ({frames.length})</h2>
        <button onClick={onClear}>지우기</button>
      </div>
      <div className="rx-table-wrap">
        <table>
          <thead>
            <tr>
              <th>시각(s)</th>
              <th>CH</th>
              <th>ID</th>
              <th>형식</th>
              <th>DLC</th>
              <th>데이터</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  수신된 프레임이 없습니다. 연결 후 트래픽을 기다리세요.
                </td>
              </tr>
            )}
            {rows.map((f) => (
              <tr key={f._seq}>
                <td className="mono">{f.ts.toFixed(3)}</td>
                <td>{f.channel}</td>
                <td className="mono">{fmtId(f.can_id, f.extended)}</td>
                <td>
                  {f.extended ? 'EXT' : 'STD'}
                  {f.rtr ? '/RTR' : ''}
                </td>
                <td>{f.dlc}</td>
                <td className="mono">{fmtData(f.data)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
