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
      <header className="app-header">
        <h1>CANalyst-II Controller</h1>
        <StatusBadge connState={connState} status={status} />
      </header>

      <ConnectionBar
        devices={devices}
        status={status}
        onConnect={connect}
        onDisconnect={disconnect}
        onRefresh={refreshDevices}
      />

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
      />

      <StatsPanel stats={stats} onReset={resetStats} />

      {error && (
        <p className="app-error" onClick={clearError} title="클릭하여 닫기">
          오류: {error}
        </p>
      )}

      <div className="main-grid">
        <RxMonitor frames={frames} onClear={clearFrames} onUseFrame={setTxPrefill} />
        {/* 우측 송신 컬럼: 일반 프레임 송신 + DBC 인코딩 송신을 세로로 쌓는다(2열 그리드 유지) */}
        <div className="tx-column">
          <TxPanel status={status} onSend={sendFrame} prefill={txPrefill} />
          <DbcTxPanel
            dbcMessages={dbcMessages}
            onListMessages={listDbcMessages}
            onEncodeSend={encodeSend}
            connected={!!status?.connected}
          />
        </div>
      </div>
    </div>
  )
}
