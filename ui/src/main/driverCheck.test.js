// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseDriverState } from './driverCheck'

describe('parseDriverState', () => {
  it("빈 출력/공백/ABSENT → absent", () => {
    expect(parseDriverState('').state).toBe('absent')
    expect(parseDriverState('   \n  ').state).toBe('absent')
    expect(parseDriverState('ABSENT').state).toBe('absent')
    expect(parseDriverState('absent\n').state).toBe('absent')
    expect(parseDriverState(undefined).state).toBe('absent')
  })

  it('WinUSB 서비스면 ok (대소문자 무시)', () => {
    expect(parseDriverState('WinUSB').state).toBe('ok')
    expect(parseDriverState('winusb\r\n').state).toBe('ok')
  })

  it('WinUSB 가 아닌 드라이버면 wrong-driver 이고 services 를 보존한다', () => {
    const r = parseDriverState('usbccgp')
    expect(r.state).toBe('wrong-driver')
    expect(r.services).toEqual(['usbccgp'])
  })

  it('여러 장치 중 하나라도 WinUSB 면 ok', () => {
    expect(parseDriverState('usbccgp\r\nWinUSB').state).toBe('ok')
  })

  it('여러 장치가 모두 비-WinUSB 면 wrong-driver', () => {
    const r = parseDriverState('usbccgp\nlibusb0')
    expect(r.state).toBe('wrong-driver')
    expect(r.services).toEqual(['usbccgp', 'libusb0'])
  })
})
