import { Fragment, useRef } from 'react'

function fmtData(data) {
  return data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function fmtId(id, extended) {
  return '0x' + id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
}

// DBC 디코딩 결과 signals({이름:값})를 "이름=값" 나열 문자열로 변환
function fmtSignals(signals) {
  return Object.entries(signals)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ')
}

// 첫 프레임(t0) 기준 상대 경과초로 표시한다.
// mock(거대한 epoch초)·실장비(작은 상대초) 모두 같은 형식으로 보이게 한다.
// 1분 미만은 +0.000 식, 그 이상은 분:초.밀리초(m:ss.mmm)로 표시.
function fmtElapsed(ts, t0) {
  const dt = ts - t0
  if (dt < 60) return `+${dt.toFixed(3)}`
  const m = Math.floor(dt / 60)
  const s = dt - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

export default function RxMonitor({ frames, onClear }) {
  // 첫 프레임의 ts 를 한 번만 앵커링한다. 500개 상한으로 윈도우가 밀려도
  // 기준점이 흔들리지 않도록 useRef 로 보관하고, 비워지면(지우기) 리셋한다.
  const t0Ref = useRef(null)
  if (frames.length === 0) {
    t0Ref.current = null
  } else if (t0Ref.current === null) {
    t0Ref.current = frames[0].ts // frames[0] = 가장 오래된 프레임
  }
  const t0 = t0Ref.current

  const rows = frames.slice().reverse() // 최신이 위로

  return (
    <section className="rx-monitor">
      <div className="panel-header">
        <h2>송수신 모니터 ({frames.length})</h2>
        <button onClick={onClear}>지우기</button>
      </div>
      <div className="rx-table-wrap">
        <table>
          <thead>
            <tr>
              <th>경과(s)</th>
              <th>방향</th>
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
                <td colSpan={7} className="empty">
                  아직 송수신된 프레임이 없습니다. 연결 후 송신하거나 트래픽을 기다리세요.
                </td>
              </tr>
            )}
            {rows.map((f) => {
              const dir = f.dir === 'tx' ? 'tx' : 'rx'
              return (
                <Fragment key={f._seq}>
                  <tr className={`frame-${dir}`}>
                    <td className="mono">{fmtElapsed(f.ts, t0)}</td>
                    <td>
                      <span className={`dir-badge dir-${dir}`}>{dir === 'tx' ? 'TX' : 'RX'}</span>
                    </td>
                    <td>{f.channel}</td>
                    <td className="mono">{fmtId(f.can_id, f.extended)}</td>
                    <td>
                      {f.extended ? 'EXT' : 'STD'}
                      {f.rtr ? '/RTR' : ''}
                    </td>
                    <td>{f.dlc}</td>
                    <td className="mono">{fmtData(f.data)}</td>
                  </tr>
                  {/* DBC 로드 시 디코딩된 메시지명·신호를 서브행으로 표시 */}
                  {f.decoded && (
                    <tr className="decoded-row">
                      <td colSpan={7}>
                        <span className="decoded-msg">{f.decoded.message}</span>{' '}
                        <span className="decoded-signals mono">{fmtSignals(f.decoded.signals)}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
