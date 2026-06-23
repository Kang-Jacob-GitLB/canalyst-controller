import { useEffect, useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'

// 표준 비트레이트(canalystii 는 임의값도 받지만 표준값 권장 → 드롭다운 고정)
const BITRATES = [10000, 20000, 50000, 100000, 125000, 250000, 500000, 800000, 1000000]

// WinUSB 드라이버 교체 도구. main 의 open-external 이 https 만 허용한다.
const ZADIG_URL = 'https://zadig.akeo.ie/'

// 장치가 안 보일 때 그 원인(드라이버 상태)을 사용자에게 안내한다.
// hint.state: 'wrong-driver' | 'absent' | 'ok' | 'unsupported' | 'unknown'
function DriverHint({ hint }) {
  if (hint.state === 'wrong-driver') {
    return (
      <div className="driver-hint driver-hint-warn" role="status">
        <p>
          CANalyst-II 장치가 감지됐지만 <b>WinUSB 드라이버가 아닙니다</b>
          {hint.services?.length ? ` (현재 드라이버: ${hint.services.join(', ')})` : ''}. 이
          앱은 WinUSB 로만 장치에 접근하므로, Zadig 로 드라이버를 WinUSB 로 한 번 바꿔야
          연결됩니다.
        </p>
        <button type="button" onClick={() => window.canctl?.openExternal?.(ZADIG_URL)}>
          Zadig 받기
        </button>
      </div>
    )
  }
  if (hint.state === 'absent') {
    return (
      <p className="driver-hint" role="status">
        CANalyst-II 장치가 보이지 않습니다. USB 연결을 확인한 뒤 “장치 새로고침”을 눌러 주세요.
      </p>
    )
  }
  // ok(드라이버 정상인데 목록이 빈 드문 경우)·unsupported(비-Windows)·unknown: 별도 안내 없음
  return null
}

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
  // 표준 드롭다운 값(항상 숫자) — 기존 동작/키 유지
  const [bitrate, setBitrate] = usePersistentState('canctl.conn.bitrate', 500000)
  // 'standard' | 'custom' — 어느 쪽 비트레이트를 쓸지
  const [bitrateMode, setBitrateMode] = usePersistentState('canctl.conn.bitrateMode', 'standard')
  // 사용자 지정 입력값(controlled, 문자열로 보존 — 빈칸/입력중 상태 표현 위해)
  const [bitrateCustom, setBitrateCustom] = usePersistentState('canctl.conn.bitrateCustom', '')
  const connected = !!status?.connected

  // 장치가 0개이고 미연결일 때만, 왜 안 보이는지(미연결/드라이버 문제)를 진단한다.
  const [driverHint, setDriverHint] = useState(null)
  const noDevices = !connected && devices.length === 0
  useEffect(() => {
    if (!noDevices) {
      setDriverHint(null)
      return
    }
    const check = window.canctl?.checkDriver
    if (typeof check !== 'function') return // 비-Electron(테스트) 환경: 진단 생략
    let cancelled = false
    check()
      .then((r) => {
        if (!cancelled) setDriverHint(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [noDevices])

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

      {/* 채널 선택기 없음: 연결 시 두 채널(0,1)을 모두 열므로 연결 단계에서
          채널을 고를 필요가 없다. 송신 채널은 송신 폼에서, 수신 채널은 필터에서 고른다. */}

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
          // 두 채널을 모두 여므로 connect 의 channel 인자는 쓰이지 않는다(프로토콜 호환용 0).
          onClick={() => onConnect(deviceIndex, 0, effectiveBitrate)}
          disabled={customInvalid}
        >
          연결
        </button>
      )}
      <button onClick={onRefresh} disabled={connected}>
        장치 새로고침
      </button>

      {noDevices && driverHint && <DriverHint hint={driverHint} />}

      {customInvalid && (
        <p className="app-error">비트레이트는 양의 정수(bps)여야 합니다.</p>
      )}
    </div>
  )
}
