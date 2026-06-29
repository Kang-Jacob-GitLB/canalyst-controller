import { useEffect, useState } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'

// 표준 비트레이트(드라이버 TIMINGS 표에 등록된 값 → 드롭다운 고정)
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

// 드롭다운에서 "사용자 지정" 항목을 식별하는 sentinel. select value 로만 쓰인다.
const CUSTOM = 'custom'

// 사용자 지정 입력 문자열이 유효한 양의 정수 비트레이트인지 검사한다.
function parseCustomBitrate(text) {
  const trimmed = String(text).trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n > 0 ? n : null
}

// 비트레이트 선택 UI(드롭다운 + 사용자 지정 입력). 상태는 부모가 소유하고 props 로 내려준다.
// 채널0/채널1 이 동일 UI 를 재사용한다.
function BitrateControls({
  label, customLabel, bitrate, isCustom, customText, invalid, disabled,
  onSelect, onCustomChange, customPlaceholder
}) {
  return (
    <>
      <label>
        {label}
        <select value={isCustom ? CUSTOM : bitrate} onChange={onSelect} disabled={disabled}>
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
          {customLabel}
          <input
            type="number"
            min="1"
            step="1"
            placeholder={customPlaceholder}
            value={customText}
            onChange={onCustomChange}
            disabled={disabled}
            aria-invalid={invalid}
          />
        </label>
      )}
    </>
  )
}

export default function ConnectionBar({ devices, status, onConnect, onDisconnect, onRefresh }) {
  const [deviceIndex, setDeviceIndex] = usePersistentState('canctl.conn.deviceIndex', 0)
  // 채널0 비트레이트(기존 키 유지 — 저장된 사용자 설정 보존)
  const [bitrate, setBitrate] = usePersistentState('canctl.conn.bitrate', 500000)
  const [bitrateMode, setBitrateMode] = usePersistentState('canctl.conn.bitrateMode', 'standard')
  const [bitrateCustom, setBitrateCustom] = usePersistentState('canctl.conn.bitrateCustom', '')
  // 채널별 다른 속도(채널1 비트레이트를 따로 지정). 기본 off → 기존 동작과 동일.
  const [split, setSplit] = usePersistentState('canctl.conn.splitChannels', false)
  // 채널1 비트레이트(split 일 때만 사용·노출)
  const [bitrate1, setBitrate1] = usePersistentState('canctl.conn.bitrate1', 250000)
  const [bitrate1Mode, setBitrate1Mode] = usePersistentState('canctl.conn.bitrate1Mode', 'standard')
  const [bitrate1Custom, setBitrate1Custom] = usePersistentState('canctl.conn.bitrate1Custom', '')
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

  // 채널0 유효 비트레이트
  const isCustom0 = bitrateMode === CUSTOM
  const customValue0 = parseCustomBitrate(bitrateCustom)
  const invalid0 = isCustom0 && customValue0 === null
  const effectiveBitrate0 = isCustom0 ? customValue0 : bitrate
  // 채널1 유효 비트레이트(split 일 때만 의미)
  const isCustom1 = bitrate1Mode === CUSTOM
  const customValue1 = parseCustomBitrate(bitrate1Custom)
  const invalid1 = split && isCustom1 && customValue1 === null
  const effectiveBitrate1 = isCustom1 ? customValue1 : bitrate1

  const connectInvalid = invalid0 || invalid1

  // 드롭다운 onChange: '사용자 지정' 선택 시 custom 모드, 아니면 표준값 갱신.
  function makeSelectHandler(setMode, setStandard) {
    return (e) => {
      const v = e.target.value
      if (v === CUSTOM) {
        setMode(CUSTOM)
      } else {
        setMode('standard')
        setStandard(Number(v))
      }
    }
  }
  const handleBitrate0Select = makeSelectHandler(setBitrateMode, setBitrate)
  const handleBitrate1Select = makeSelectHandler(setBitrate1Mode, setBitrate1)

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

      {/* 채널 선택기 없음: 연결 시 두 채널(0,1)을 모두 연다. 채널별 비트레이트는 아래 토글로 분리. */}

      <BitrateControls
        label={split ? '채널0 비트레이트' : '비트레이트'}
        customLabel={split ? '채널0 사용자 지정(bps)' : '사용자 지정(bps)'}
        bitrate={bitrate}
        isCustom={isCustom0}
        customText={bitrateCustom}
        invalid={invalid0}
        disabled={connected}
        onSelect={handleBitrate0Select}
        onCustomChange={(e) => setBitrateCustom(e.target.value)}
        customPlaceholder="예: 83330"
      />

      <label className="conn-split-toggle">
        <input
          type="checkbox"
          checked={split}
          onChange={(e) => setSplit(e.target.checked)}
          disabled={connected}
        />
        채널별 다른 속도
      </label>

      {split && (
        <BitrateControls
          label="채널1 비트레이트"
          customLabel="채널1 사용자 지정(bps)"
          bitrate={bitrate1}
          isCustom={isCustom1}
          customText={bitrate1Custom}
          invalid={invalid1}
          disabled={connected}
          onSelect={handleBitrate1Select}
          onCustomChange={(e) => setBitrate1Custom(e.target.value)}
          customPlaceholder="예: 250000"
        />
      )}

      {connected ? (
        <button className="btn-danger" onClick={onDisconnect}>
          연결 해제
        </button>
      ) : (
        <button
          className="btn-primary"
          // 두 채널을 모두 여므로 connect 의 channel 인자는 쓰이지 않는다(프로토콜 호환용 0).
          // split off 면 4번째 인자를 아예 넘기지 않아 두 채널이 같은 속도로 열린다(기존 동작).
          onClick={() =>
            split
              ? onConnect(deviceIndex, 0, effectiveBitrate0, effectiveBitrate1)
              : onConnect(deviceIndex, 0, effectiveBitrate0)
          }
          disabled={connectInvalid}
        >
          연결
        </button>
      )}
      <button onClick={onRefresh} disabled={connected}>
        장치 새로고침
      </button>

      {noDevices && driverHint && <DriverHint hint={driverHint} />}

      {connectInvalid && (
        <p className="app-error">비트레이트는 양의 정수(bps)여야 합니다.</p>
      )}
    </div>
  )
}
