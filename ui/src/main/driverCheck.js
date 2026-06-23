import { execFile } from 'child_process'

// CANalyst-II USB 식별자. python-can 의 canalystii 백엔드는 libusb 로 이 장치
// (Microchip VID 04D8 / PID 0053)에 직접 접근하므로, 벤더 드라이버가 아니라
// WinUSB 바인딩을 요구한다 → 보통 Zadig 로 1회 드라이버를 교체해야 한다.
export const CANALYST_USB_ID = 'VID_04D8&PID_0053'

/**
 * Get-PnpDevice 조회 결과를 해석해 드라이버 상태를 판정한다(순수 함수, 테스트 용이).
 *
 * @param stdout 현재 연결된 CANalyst-II 들의 드라이버 Service 이름을 줄단위로 담은
 *               텍스트(장치가 없으면 'ABSENT').
 * @returns {{state:'absent'|'ok'|'wrong-driver', services:string[]}}
 *   - 'absent'       : 장치가 현재 연결돼 있지 않음(또는 enum 안 됨)
 *   - 'ok'           : WinUSB 로 바인딩됨 → 앱이 바로 접근 가능
 *   - 'wrong-driver' : 장치는 있으나 WinUSB 가 아닌 드라이버(벤더/기타) → Zadig 필요
 */
export function parseDriverState(stdout) {
  const out = String(stdout ?? '').trim()
  if (out === '' || out.toUpperCase() === 'ABSENT') return { state: 'absent', services: [] }
  const services = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (services.length === 0) return { state: 'absent', services: [] }
  const onWinusb = services.some((s) => /^winusb$/i.test(s))
  return { state: onWinusb ? 'ok' : 'wrong-driver', services }
}

/**
 * 현재 연결된 CANalyst-II 의 WinUSB 드라이버 상태를 조회한다(Windows 전용).
 * 비-Windows 는 'unsupported', 조회 실패는 'unknown' 을 돌려준다.
 * @returns {Promise<{state:string, services:string[]}>}
 */
export function checkCanalystDriver() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ state: 'unsupported', services: [] })
    // 현재 연결(-PresentOnly)된 04D8:0053 장치들의 드라이버 Service 이름을 출력.
    // 없으면 'ABSENT'. execFile 로 인자를 배열 전달하므로 셸 이스케이프 문제는 없다.
    const ps =
      `$d = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.InstanceId -like 'USB\\${CANALYST_USB_ID}*' }; ` +
      `if (-not $d) { 'ABSENT' } else { ` +
      `$d | ForEach-Object { (Get-PnpDeviceProperty -InstanceId $_.InstanceId ` +
      `-KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue).Data } }`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? { state: 'unknown', services: [] } : parseDriverState(stdout))
    )
  })
}
