import { useState } from 'react'
import { useCanSocket } from './hooks/useCanSocket'
import StatusBadge from './components/StatusBadge'
import ConnectionBar from './components/ConnectionBar'
import ToolsPanel from './components/ToolsPanel'
import StatsPanel from './components/StatsPanel'
import RxMonitor from './components/RxMonitor'
import TxPanel from './components/TxPanel'
import DbcTxPanel from './components/DbcTxPanel'

export default function App() {
  const url = window.canctl?.coreUrl ?? 'ws://127.0.0.1:8765'
  const {
    connState,
    status,
    devices,
    frames,
    error,
    errorSeq,
    filterIds,
    logStatus,
    replayStatus,
    stats,
    dbcMessages,
    connect,
    disconnect,
    sendFrame,
    refreshDevices,
    clearFrames,
    clearError,
    resetStats,
    setFilter,
    startLog,
    stopLog,
    replay,
    stopReplay,
    loadDbc,
    listDbcMessages,
    encodeSend,
    filterMeta,
    exportStatus,
    exportLog
  } = useCanSocket(url)

  // 모니터 행 더블클릭 → 송신 폼 프리필(행→TX). null=프리필 없음.
  const [txPrefill, setTxPrefill] = useState(null)

  return (
    <div className="app">
      {/* 좌측 라이브러리 레일: 브랜드 + 상태 + 연결 + 도구(자주 안 만지는 설정) */}
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-text">
            <h1>CANalyst-II</h1>
            <span className="brand-sub">CAN 분석 콘솔</span>
          </div>
        </div>

        <StatusBadge connState={connState} status={status} />

        <section className="side-section">
          <h2 className="side-title">연결</h2>
          <ConnectionBar
            devices={devices}
            status={status}
            onConnect={connect}
            onDisconnect={disconnect}
            onRefresh={refreshDevices}
          />
        </section>

        <section className="side-section side-tools">
          <ToolsPanel
            filterIds={filterIds}
            filterMeta={filterMeta}
            logStatus={logStatus}
            replayStatus={replayStatus}
            exportStatus={exportStatus}
            onSetFilter={setFilter}
            onExportLog={exportLog}
            onStartLog={startLog}
            onStopLog={stopLog}
            onReplay={replay}
            onStopReplay={stopReplay}
            onLoadDbc={loadDbc}
          />
        </section>
      </nav>

      {/* 메인: 송수신 모니터(주인공, 전체 높이) + 우측 컨트롤 레일(독립 스크롤) */}
      <main className="main">
        {error && (
          // key={errorSeq}: 새 에러(같은 메시지여도)마다 재마운트되어 enter 애니메이션을
          // 다시 실행 → 사용자가 "새 에러 발생"을 인지한다. role="alert"로 재안내도 함께.
          <div key={errorSeq} className="app-error" role="alert">
            <span className="app-error-text">오류: {error}</span>
            <button
              type="button"
              className="app-error-close"
              onClick={clearError}
              title="닫기"
              aria-label="오류 닫기"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}

        <div className="console">
          <RxMonitor frames={frames} onClear={clearFrames} onUseFrame={setTxPrefill} />
          <aside className="rail">
            <StatsPanel stats={stats} onReset={resetStats} />
            <TxPanel status={status} onSend={sendFrame} prefill={txPrefill} />
            <DbcTxPanel
              dbcMessages={dbcMessages}
              onListMessages={listDbcMessages}
              onEncodeSend={encodeSend}
              connected={!!status?.connected}
            />
          </aside>
        </div>
      </main>
    </div>
  )
}
