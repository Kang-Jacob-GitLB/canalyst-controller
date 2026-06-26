import { useState, useRef, useEffect } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'
import { makeTimestampedName } from '../utils/csvExport'

// 폴더 경로와 파일명을 OS 구분자로 잇는다(폴더 끝 구분자 중복은 제거).
// 구분자는 preload 가 노출한 OS 값(win '\\', posix '/') — 렌더러엔 path.join 이 없어
// 직접 잇되 플랫폼 구분자를 써서 win/mac/linux 모두에서 올바른 경로를 만든다.
function joinPath(dir, name) {
  const sep = (typeof window !== 'undefined' && window.canctl?.pathSep) || '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

// 긴 경로의 우측(최하위 폴더/파일명)이 보이도록 값 변경 시 입력칸을 끝으로 스크롤한다.
// 포커스 중에는 사용자의 캐럿/스크롤을 방해하지 않는다. 전체 경로는 title 로 hover 노출.
// (dir="rtl" 은 경로 구분자 순서를 시각적으로 뒤집어 쓰지 않는다.)
function PathInput({ value, onChange, placeholder, disabled }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth
  }, [value])
  return (
    <input
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      title={value}
    />
  )
}

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

// 마스크 입력 문자열(hex 한 값)을 파싱한다.
// 빈 입력=undefined(정확일치). 잘못된 토큰이면 { error }. "0" 은 유효값(0)으로 통과.
function parseMaskInput(raw) {
  const trimmed = raw.trim()
  if (trimmed === '') return { mask: undefined }
  const mask = parseInt(trimmed, 16)
  if (Number.isNaN(mask) || mask < 0) {
    return { error: `잘못된 마스크: ${trimmed} (16진수만, 예: 7FF)` }
  }
  return { mask }
}

// "현재 필터" 표시 문자열을 단일 텍스트로 조립한다.
// 텍스트 노드를 쪼개지 않아야(JSX 조각 분할 방지) 표시·테스트가 모두 견고하다.
// filterIds: null=미통지, []=전체통과, [..]=hex 목록.
// filterMeta: null=미통지, {mask,channel}(mask undefined=정확일치, channel null=전체).
function fmtCurrentFilter(filterIds, filterMeta) {
  if (filterIds === null) return '—'
  let s = filterIds.length === 0 ? '전체 통과' : fmtFilterIds(filterIds)
  if (filterMeta) {
    if (filterMeta.mask != null) {
      s += ` · 마스크 ${filterMeta.mask.toString(16).toUpperCase()}`
    }
    s += ` · 채널 ${filterMeta.channel == null ? '전체' : filterMeta.channel}`
  }
  return s
}

export default function ToolsPanel({
  filterIds,
  filterMeta,
  logStatus,
  exportStatus,
  onSetFilter,
  onExportLog,
  onStartLog,
  onStopLog,
  onReplay,
  onLoadDbc,
  initialCollapsed = false
}) {
  const [filterStr, setFilterStr] = usePersistentState('canctl.tools.filterStr', '')
  const [maskStr, setMaskStr] = usePersistentState('canctl.tools.maskStr', '')
  const [channelSel, setChannelSel] = usePersistentState('canctl.tools.channelSel', '') // ''=전체, '0', '1'
  const [filterErr, setFilterErr] = useState(null)
  // 로그 저장은 '폴더'만 지정하고 파일명은 자동 생성한다(이름-날짜-시간). 과거엔 전체 파일경로를
  // 저장했으므로 키를 logDir/exportDir 로 새로 둬 과거 전체경로 값이 폴더로 오인되지 않게 한다.
  const [logDir, setLogDir] = usePersistentState('canctl.tools.logDir', '')
  const [replayPath, setReplayPath] = usePersistentState('canctl.tools.replayPath', '')
  const [dbcPath, setDbcPath] = usePersistentState('canctl.tools.dbcPath', '')
  const [exportSrc, setExportSrc] = usePersistentState('canctl.tools.exportSrc', '')
  const [exportDir, setExportDir] = usePersistentState('canctl.tools.exportDir', '')
  const [exportFormat, setExportFormat] = usePersistentState('canctl.tools.exportFormat', 'asc')
  // 도구 패널 접기(기본값은 App 이 initialCollapsed 로 지정 — 앱은 접힘, 테스트는 펼침)
  const [collapsed, setCollapsed] = usePersistentState('canctl.tools.collapsed', initialCollapsed)

  // 파일 다이얼로그는 Electron(preload)에서만 제공 — 일반 브라우저면 버튼 숨김
  const canPick = typeof window !== 'undefined' && !!window.canctl?.pickOpenFile

  const LOG_FILTERS = [{ name: '로그(JSONL)', extensions: ['jsonl', 'log'] }]
  const DBC_FILTERS = [{ name: 'DBC', extensions: ['dbc'] }]

  function applyFilter(e) {
    e.preventDefault()
    setFilterErr(null)
    const { ids, error } = parseFilterInput(filterStr)
    if (error) {
      setFilterErr(error)
      return
    }
    const { mask, error: maskError } = parseMaskInput(maskStr)
    if (maskError) {
      setFilterErr(maskError)
      return
    }
    // select 는 항상 문자열 → ''=전체(null), '0'/'1'=정수로 변환. channel=0 은 유효값.
    const channel = channelSel === '' ? null : Number(channelSel)
    onSetFilter(ids, mask, channel)
  }

  async function browseLogDir() {
    const p = await window.canctl?.pickDirectory?.()
    if (p) setLogDir(p)
  }
  async function browseReplay() {
    const p = await window.canctl?.pickOpenFile?.({ filters: LOG_FILTERS })
    if (p) setReplayPath(p)
  }
  async function browseDbc() {
    const p = await window.canctl?.pickOpenFile?.({ filters: DBC_FILTERS })
    if (p) setDbcPath(p)
  }
  async function browseExportSrc() {
    const p = await window.canctl?.pickOpenFile?.({ filters: LOG_FILTERS })
    if (p) setExportSrc(p)
  }
  async function browseExportDir() {
    const p = await window.canctl?.pickDirectory?.()
    if (p) setExportDir(p)
  }

  // 로깅 시작: 폴더 + 자동 파일명(canctl-log-날짜-시간.jsonl)을 합쳐 코어에 넘긴다.
  function startLogging() {
    onStartLog(joinPath(logDir, makeTimestampedName('canctl-log', 'jsonl')))
  }
  // 내보내기: 폴더 + 자동 파일명(canctl-export-날짜-시간.<포맷>)을 합쳐 코어에 넘긴다.
  function runExport() {
    onExportLog(
      exportSrc,
      joinPath(exportDir, makeTimestampedName('canctl-export', exportFormat)),
      exportFormat
    )
  }

  const logging = !!logStatus?.logging

  return (
    <section className="tools-panel">
      <div className="panel-header">
        <button
          type="button"
          className="tools-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="chev">{collapsed ? '▸' : '▾'}</span> 도구
        </button>
      </div>

      {!collapsed && (
        <>
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
        <label>
          마스크(hex · 빈칸=정확일치)
          <input
            value={maskStr}
            onChange={(e) => setMaskStr(e.target.value)}
            placeholder="7FF"
          />
        </label>
        <label>
          채널
          <select value={channelSel} onChange={(e) => setChannelSel(e.target.value)}>
            <option value="">전체</option>
            <option value="0">0</option>
            <option value="1">1</option>
          </select>
        </label>
        <button type="submit" className="btn-primary">
          필터 적용
        </button>
      </form>
      <p className="tools-state">현재 필터: {fmtCurrentFilter(filterIds, filterMeta)}</p>
      {filterErr && <p className="tools-err">{filterErr}</p>}

      {/* 파일 로깅: 폴더만 지정, 파일명은 자동(canctl-log-날짜-시간.jsonl) */}
      <div className="tools-row">
        <label className="grow">
          로그 저장 폴더 (파일명 자동)
          <PathInput
            value={logDir}
            onChange={(e) => setLogDir(e.target.value)}
            placeholder="C:\\logs"
            disabled={logging}
          />
        </label>
        {canPick && (
          <button type="button" onClick={browseLogDir} disabled={logging}>
            폴더 선택
          </button>
        )}
        {logging ? (
          <button className="btn-danger" onClick={onStopLog}>
            로깅 중지
          </button>
        ) : (
          <button className="btn-primary" onClick={startLogging} disabled={logDir.trim() === ''}>
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
            placeholder="C:\\logs\\can.jsonl"
          />
        </label>
        {canPick && (
          <button type="button" onClick={browseReplay}>
            찾아보기
          </button>
        )}
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
        {canPick && (
          <button type="button" onClick={browseDbc}>
            찾아보기
          </button>
        )}
        <button onClick={() => onLoadDbc(dbcPath)} disabled={dbcPath.trim() === ''}>
          DBC 로드
        </button>
      </div>

      {/* 로그 내보내기(기록된 JSONL → 표준 포맷 ASC/CSV/BLF) */}
      <div className="tools-row">
        <label className="grow">
          내보낼 로그(JSONL)
          <input
            value={exportSrc}
            onChange={(e) => setExportSrc(e.target.value)}
            placeholder="C:\\logs\\src.jsonl"
          />
        </label>
        {canPick && (
          <button type="button" onClick={browseExportSrc}>
            찾아보기
          </button>
        )}
      </div>
      <div className="tools-row">
        <label className="grow">
          내보내기 저장 폴더 (파일명 자동)
          <PathInput
            value={exportDir}
            onChange={(e) => setExportDir(e.target.value)}
            placeholder="C:\\logs"
          />
        </label>
        {canPick && (
          <button type="button" onClick={browseExportDir}>
            폴더 선택
          </button>
        )}
        <label>
          포맷
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
            <option value="asc">ASC</option>
            <option value="csv">CSV</option>
            <option value="blf">BLF</option>
          </select>
        </label>
        <button
          className="btn-primary"
          onClick={runExport}
          disabled={exportSrc.trim() === '' || exportDir.trim() === ''}
        >
          내보내기
        </button>
      </div>
      {exportStatus && (
        <p className={exportStatus.ok ? 'tools-state' : 'tools-err'}>
          {exportStatus.ok
            ? `${exportStatus.count}개 내보냄 → ${exportStatus.path}`
            : '내보내기 실패'}
        </p>
      )}
        </>
      )}
    </section>
  )
}
