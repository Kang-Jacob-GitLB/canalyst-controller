import { useState } from 'react'

// 표준 비트레이트(canalystii 는 임의값도 받지만 표준값 권장 → 드롭다운 고정)
const BITRATES = [10000, 20000, 50000, 100000, 125000, 250000, 500000, 800000, 1000000]

export default function ConnectionBar({ devices, status, onConnect, onDisconnect, onRefresh }) {
  const [deviceIndex, setDeviceIndex] = useState(0)
  const [channel, setChannel] = useState(0)
  const [bitrate, setBitrate] = useState(500000)
  const connected = !!status?.connected

  return (
    <div className="connection-bar">
      <label>
        장치
        <select
          value={deviceIndex}
          onChange={(e) => setDeviceIndex(Number(e.target.value))}
          disabled={connected}
        >
          {devices.length === 0 && <option value={0}>(장치 없음)</option>}
          {devices.map((d) => (
            <option key={d.index} value={d.index}>
              {d.name} (#{d.index})
            </option>
          ))}
        </select>
      </label>

      <label>
        채널
        <select
          value={channel}
          onChange={(e) => setChannel(Number(e.target.value))}
          disabled={connected}
        >
          <option value={0}>0</option>
          <option value={1}>1</option>
        </select>
      </label>

      <label>
        비트레이트
        <select
          value={bitrate}
          onChange={(e) => setBitrate(Number(e.target.value))}
          disabled={connected}
        >
          {BITRATES.map((b) => (
            <option key={b} value={b}>
              {b.toLocaleString()} bps
            </option>
          ))}
        </select>
      </label>

      {connected ? (
        <button className="btn-danger" onClick={onDisconnect}>
          연결 해제
        </button>
      ) : (
        <button className="btn-primary" onClick={() => onConnect(deviceIndex, channel, bitrate)}>
          연결
        </button>
      )}
      <button onClick={onRefresh} disabled={connected}>
        장치 새로고침
      </button>
    </div>
  )
}
