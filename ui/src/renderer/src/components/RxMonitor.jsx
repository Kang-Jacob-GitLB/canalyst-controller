import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { framesToCsv, downloadCsv, csvFilename } from '../utils/csvExport'

// 표시 상한 선택지(고부하 시 렌더 행 수 제한). hook 의 MAX_FRAMES(500) 와 별개로
// "표시만" 제한한다. frames 누적·통계는 영향받지 않는다.
const DISPLAY_LIMITS = [100, 200, 500]

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

// 검색어로 프레임 1개가 매칭되는지 판정. CAN ID(hex) 또는 data(hex) 부분일치.
// 대소문자·0x 접두·공백 무시. 빈 검색어는 항상 통과.
function matchesQuery(frame, query) {
  if (!query) return true
  const q = query.toLowerCase().replace(/^0x/, '').replace(/\s+/g, '')
  if (!q) return true
  const idHex = frame.can_id.toString(16).toLowerCase()
  if (idHex.includes(q)) return true
  const dataHex = frame.data.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase()
  return dataHex.includes(q)
}

export default function RxMonitor({ frames, onClear }) {
  // 일시정지: 켜면 그 시점 frames 를 스냅샷으로 고정하고 표시·자동스크롤을 멈춘다.
  // 끄면 라이브 frames 로 복귀. frames 누적 자체는 백그라운드에서 계속된다.
  const [paused, setPaused] = useState(false)
  const [snapshot, setSnapshot] = useState([])
  const [query, setQuery] = useState('') // 검색/필터 텍스트
  const [grouped, setGrouped] = useState(false) // ID별 집계뷰 토글
  const [displayLimit, setDisplayLimit] = useState(500) // 표시 최대 행 수

  // 일시정지 토글: 진입 시 현재 frames 를 스냅샷으로 잡고, 해제 시 라이브 복귀.
  function togglePause() {
    setPaused((p) => {
      if (!p) setSnapshot(frames)
      return !p
    })
  }

  // 표시에 쓸 원본: 일시정지면 스냅샷, 아니면 라이브 frames
  const source = paused ? snapshot : frames

  // 첫 프레임의 ts 를 한 번만 앵커링한다. 500개 상한으로 윈도우가 밀려도
  // 기준점이 흔들리지 않도록 useRef 로 보관하고, 비워지면(지우기) 리셋한다.
  const t0Ref = useRef(null)
  if (source.length === 0) {
    t0Ref.current = null
  } else if (t0Ref.current === null) {
    t0Ref.current = source[0].ts // source[0] = 가장 오래된 프레임
  }
  const t0 = t0Ref.current

  // 검색 필터 적용 후 표시 상한만큼 최신 쪽을 남긴다(누적은 건드리지 않음).
  const filtered = useMemo(() => {
    const f = query ? source.filter((fr) => matchesQuery(fr, query)) : source
    return f.length > displayLimit ? f.slice(f.length - displayLimit) : f
  }, [source, query, displayLimit])

  // ID별 집계: 현재 표시중인(필터·상한 적용 후) 창에서 ID별 최신값·카운트·창내 레이트를 만든다.
  // 누적 통계(StatsPanel)와 달리 "현재 창" 기준이므로 숫자가 다를 수 있다(의도된 차이).
  const groupRows = useMemo(() => {
    if (!grouped) return []
    const map = new Map()
    for (const f of filtered) {
      const key = `${f.can_id}|${f.extended ? 1 : 0}`
      const ex = map.get(key)
      if (ex) {
        ex.count += 1
        ex.last = f // 최신 프레임으로 갱신(filtered 는 오래된→최신 순)
      } else {
        map.set(key, { count: 1, last: f, first: f })
      }
    }
    const rows = []
    for (const { count, last, first } of map.values()) {
      // 창 내 레이트: 첫·마지막 프레임 ts 간격으로 추정(간격 0 이면 0)
      const span = last.ts - first.ts
      const rate = span > 0 ? (count - 1) / span : 0
      rows.push({ frame: last, count, rate })
    }
    // 카운트 내림차순(동률이면 ID 오름차순)
    rows.sort((a, b) => b.count - a.count || a.frame.can_id - b.frame.can_id)
    return rows
  }, [grouped, filtered])

  // 자동 스크롤: 일시정지가 아니고 하단 근처일 때만 최신 프레임까지 따라간다.
  const wrapRef = useRef(null)
  useEffect(() => {
    if (paused) return
    const el = wrapRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [filtered.length, paused])

  // CSV 내보내기: 표시 원본(일시정지면 스냅샷, 아니면 라이브 frames) 전체를 내보낸다.
  // 검색/표시상한과 무관하게 보유 프레임 전체가 대상이다.
  function exportCsv() {
    if (source.length === 0) return
    downloadCsv(framesToCsv(source), csvFilename())
  }

  return (
    <section className="rx-monitor">
      <div className="panel-header">
        <h2>
          송수신 모니터 ({source.length})
          {paused && <span className="rx-paused"> · 일시정지됨</span>}
        </h2>
        <div className="rx-toolbar">
          <input
            type="text"
            className="rx-search"
            placeholder="ID/데이터 검색(hex)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={togglePause} aria-pressed={paused}>
            {paused ? '재개' : '일시정지'}
          </button>
          <button onClick={() => setGrouped((g) => !g)} aria-pressed={grouped}>
            {grouped ? '로그 뷰' : 'ID별 집계'}
          </button>
          <label className="rx-limit">
            표시
            <select value={displayLimit} onChange={(e) => setDisplayLimit(Number(e.target.value))}>
              {DISPLAY_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button onClick={exportCsv}>CSV 내보내기</button>
          <button onClick={onClear}>지우기</button>
        </div>
      </div>

      <div className="rx-table-wrap" ref={wrapRef}>
        {grouped ? (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>형식</th>
                <th>최신 데이터</th>
                <th>카운트(현재 창)</th>
                <th>레이트(현재 창)</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    표시할 프레임이 없습니다.
                  </td>
                </tr>
              )}
              {groupRows.map(({ frame: f, count, rate }) => (
                <tr key={`${f.can_id}-${f.extended ? 1 : 0}`}>
                  <td className="mono">{fmtId(f.can_id, f.extended)}</td>
                  <td>
                    {f.extended ? 'EXT' : 'STD'}
                    {f.rtr ? '/RTR' : ''}
                  </td>
                  <td className="mono">{fmtData(f.data)}</td>
                  <td className="mono">{count}</td>
                  <td className="mono">{rate.toFixed(1)}/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {source.length === 0
                      ? '아직 송수신된 프레임이 없습니다. 연결 후 송신하거나 트래픽을 기다리세요.'
                      : '검색 조건에 맞는 프레임이 없습니다.'}
                  </td>
                </tr>
              )}
              {filtered.map((f) => {
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
                          <span className="decoded-signals mono">
                            {fmtSignals(f.decoded.signals)}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
