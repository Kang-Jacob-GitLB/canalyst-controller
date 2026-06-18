import { useState } from 'react'

// 허용 CAN ID 입력 문자열("100, 200, 7FF")을 정수 배열로 파싱한다.
// 빈 입력/공백만이면 빈 배열(전체 통과). 잘못된 토큰이 있으면 { error } 반환.
function parseFilterInput(raw) {
  const trimmed = raw.trim()
  if (trimmed === '') return { ids: [] }
  // 콤마(또는 공백) 구분, 빈 토큰 제거(트레일링 콤마 방어)
  const tokens = trimmed.split(/[\s,]+/).filter((t) => t !== '')
  const ids = []
  for (const t of tokens) {
    const id = parseInt(t, 16)
    if (Number.isNaN(id) || id < 0) {
      return { error: `잘못된 ID: ${t} (16진수만, 예: 100, 7FF)` }
    }
    ids.push(id)
  }
  return { ids }
}

// 정수 ID 배열을 표시용 16진수 문자열로 되돌린다(입력과 라운드트립 일관).
function fmtFilterIds(ids) {
  return ids.map((id) => id.toString(16).toUpperCase()).join(', ')
}

export default function ToolsPanel({ filterIds, logStatus, onSetFilter, onStartLog, onStopLog, onReplay, onLoadDbc }) {
  const [filterStr, setFilterStr] = useState('')
  const [filterErr, setFilterErr] = useState(null)
  const [logPath, setLogPath] = useState('')
  const [replayPath, setReplayPath] = useState('')
  const [dbcPath, setDbcPath] = useState('')

  function applyFilter(e) {
    e.preventDefault()
    setFilterErr(null)
    const { ids, error } = parseFilterInput(filterStr)
    if (error) {
      setFilterErr(error)
      return
    }
    onSetFilter(ids)
  }

  const logging = !!logStatus?.logging

  return (
    <section className="tools-panel">
      <div className="panel-header">
        <h2>도구</h2>
      </div>

      {/* 수신 필터 */}
      <form className="tools-row" onSubmit={applyFilter}>
        <label className="grow">
          수신 필터(허용 CAN ID, 16진수 콤마구분 · 빈 입력=전체)
          <input
            value={filterStr}
            onChange={(e) => setFilterStr(e.target.value)}
            placeholder="100, 200, 7FF"
          />
        </label>
        <button type="submit" className="btn-primary">
          필터 적용
        </button>
      </form>
      <p className="tools-state">
        현재 필터:{' '}
        {filterIds === null
          ? '—'
          : filterIds.length === 0
            ? '전체 통과'
            : fmtFilterIds(filterIds)}
      </p>
      {filterErr && <p className="tools-err">{filterErr}</p>}

      {/* 파일 로깅 */}
      <div className="tools-row">
        <label className="grow">
          로그 파일 경로
          <input
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="C:\\logs\\can.log"
            disabled={logging}
          />
        </label>
        {logging ? (
          <button className="btn-danger" onClick={onStopLog}>
            로깅 중지
          </button>
        ) : (
          <button className="btn-primary" onClick={() => onStartLog(logPath)} disabled={logPath.trim() === ''}>
            로깅 시작
          </button>
        )}
      </div>
      <p className="tools-state">
        로깅 상태:{' '}
        {logStatus === null
          ? '—'
          : logging
            ? `기록 중 (${logStatus.path ?? ''})`
            : '중지됨'}
      </p>

      {/* 재생 */}
      <div className="tools-row">
        <label className="grow">
          재생 파일 경로(기록된 로그)
          <input
            value={replayPath}
            onChange={(e) => setReplayPath(e.target.value)}
            placeholder="C:\\logs\\can.log"
          />
        </label>
        <button onClick={() => onReplay(replayPath)} disabled={replayPath.trim() === ''}>
          재생
        </button>
      </div>

      {/* DBC 로드 */}
      <div className="tools-row">
        <label className="grow">
          DBC 파일 경로(신호 디코딩)
          <input
            value={dbcPath}
            onChange={(e) => setDbcPath(e.target.value)}
            placeholder="C:\\dbc\\vehicle.dbc"
          />
        </label>
        <button onClick={() => onLoadDbc(dbcPath)} disabled={dbcPath.trim() === ''}>
          DBC 로드
        </button>
      </div>
    </section>
  )
}
