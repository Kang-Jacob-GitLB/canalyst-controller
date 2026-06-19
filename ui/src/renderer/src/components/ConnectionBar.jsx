import { usePersistentState } from '../hooks/usePersistentState'

// 표준 비트레이트(canalystii 는 임의값도 받지만 표준값 권장 → 드롭다운 고정)
const BITRATES = [10000, 20000, 50000, 100000, 125000, 250000, 500000, 800000, 1000000]

// 드롭다운에서 "사용자 지정" 항목을 식별하는 sentinel.
// 'canctl.conn.bitrate' 에는 절대 들어가지 않고 select value 로만 쓰인다.
const CUSTOM = 'custom'

// 사용자 지정 입력 문자열이 유효한 양의 정수 비트레이트인지 검사한다.
function parseCustomBitrate(text) {
  const trimmed = String(text).trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n > 0 ? n : null
}

export default function ConnectionBar({ devices, status, onConnect, onDisconnect, onRefresh }) {
  const [deviceIndex, setDeviceIndex] = usePersistentState('canctl.conn.deviceIndex', 0)
  const [channel, setChannel] = usePersistentState('canctl.conn.channel', 0)
  // 표준 드롭다운 값(항상 숫자) — 기존 동작/키 유지
  const [bitrate, setBitrate] = usePersistentState('canctl.conn.bitrate', 500000)
  // 'standard' | 'custom' — 어느 쪽 비트레이트를 쓸지
  const [bitrateMode, setBitrateMode] = usePersistentState('canctl.conn.bitrateMode', 'standard')
  // 사용자 지정 입력값(controlled, 문자열로 보존 — 빈칸/입력중 상태 표현 위해)
  const [bitrateCustom, setBitrateCustom] = usePersistentState('canctl.conn.bitrateCustom', '')
  const connected = !!status?.connected

  const isCustom = bitrateMode === CUSTOM
  const customValue = parseCustomBitrate(bitrateCustom)
  const customInvalid = isCustom && customValue === null
  // 실제 연결에 사용할 비트레이트: 사용자 지정 모드면 검증된 정수, 아니면 드롭다운 값
  const effectiveBitrate = isCustom ? customValue : bitrate

  function handleBitrateSelect(e) {
    const v = e.target.value
    if (v === CUSTOM) {
      setBitrateMode(CUSTOM)
    } else {
      setBitrateMode('standard')
      setBitrate(Number(v))
    }
  }

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
          value={isCustom ? CUSTOM : bitrate}
          onChange={handleBitrateSelect}
          disabled={connected}
        >
          {BITRATES.map((b) => (
            <option key={b} value={b}>
              {b.toLocaleString()} bps
            </option>
          ))}
          <option value={CUSTOM}>사용자 지정…</option>
        </select>
      </label>

      {isCustom && (
        <label>
          사용자 지정(bps)
          <input
            type="number"
            min="1"
            step="1"
            placeholder="예: 83333"
            value={bitrateCustom}
            onChange={(e) => setBitrateCustom(e.target.value)}
            disabled={connected}
            aria-invalid={customInvalid}
          />
        </label>
      )}

      {connected ? (
        <button className="btn-danger" onClick={onDisconnect}>
          연결 해제
        </button>
      ) : (
        <button
          className="btn-primary"
          onClick={() => onConnect(deviceIndex, channel, effectiveBitrate)}
          disabled={customInvalid}
        >
          연결
        </button>
      )}
      <button onClick={onRefresh} disabled={connected}>
        장치 새로고침
      </button>

      {customInvalid && (
        <p className="app-error">비트레이트는 양의 정수(bps)여야 합니다.</p>
      )}
    </div>
  )
}
