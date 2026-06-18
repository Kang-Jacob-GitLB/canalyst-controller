import { useCanSocket } from './hooks/useCanSocket'
import StatusBadge from './components/StatusBadge'
import ConnectionBar from './components/ConnectionBar'
import RxMonitor from './components/RxMonitor'
import TxPanel from './components/TxPanel'

export default function App() {
  const url = window.canctl?.coreUrl ?? 'ws://127.0.0.1:8765'
  const {
    connState,
    status,
    devices,
    frames,
    error,
    connect,
    disconnect,
    sendFrame,
    refreshDevices,
    clearFrames,
    clearError
  } = useCanSocket(url)

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

      {error && (
        <p className="app-error" onClick={clearError} title="클릭하여 닫기">
          오류: {error}
        </p>
      )}

      <div className="main-grid">
        <RxMonitor frames={frames} onClear={clearFrames} />
        <TxPanel status={status} onSend={sendFrame} />
      </div>
    </div>
  )
}
