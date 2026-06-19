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
    filterIds,
    logStatus,
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
      <header className="topbar">
        <div className="brand">
          <h1>CANalyst-II</h1>
          <StatusBadge connState={connState} status={status} />
        </div>
        <ConnectionBar
          devices={devices}
          status={status}
          onConnect={connect}
          onDisconnect={disconnect}
          onRefresh={refreshDevices}
        />
      </header>

      <ToolsPanel
        filterIds={filterIds}
        filterMeta={filterMeta}
        logStatus={logStatus}
        exportStatus={exportStatus}
        onSetFilter={setFilter}
        onExportLog={exportLog}
        onStartLog={startLog}
        onStopLog={stopLog}
        onReplay={replay}
        onLoadDbc={loadDbc}
        initialCollapsed
      />

      {error && (
        <p className="app-error" onClick={clearError} title="클릭하여 닫기">
          오류: {error}
        </p>
      )}

      {/* 콘솔: 송수신 모니터(주인공, 전체 높이) + 우측 컨트롤 레일(독립 스크롤) */}
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
    </div>
  )
}
