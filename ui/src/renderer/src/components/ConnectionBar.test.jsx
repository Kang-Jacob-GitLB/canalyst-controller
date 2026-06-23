import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ConnectionBar from './ConnectionBar'

const devices = [{ index: 0, name: 'Mock CANalyst-II', channels: 2 }]

// 일부 테스트가 window.canctl(Electron 브리지)을 모킹하므로 매 테스트 후 정리
afterEach(() => {
  delete window.canctl
})

// localStorage 격리는 vitest.setup.js 의 전역 afterEach(localStorage.clear()) 가 담당

describe('ConnectionBar', () => {
  it('미연결 시 연결 버튼 클릭 → onConnect(기본 장치0/채널0/500k)', async () => {
    const onConnect = vi.fn()
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: false }}
        onConnect={onConnect}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )
    await userEvent.setup().click(screen.getByText('연결'))
    expect(onConnect).toHaveBeenCalledWith(0, 0, 500000)
  })

  it('연결 시 해제 버튼 클릭 → onDisconnect', async () => {
    const onDisconnect = vi.fn()
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: true }}
        onConnect={() => {}}
        onDisconnect={onDisconnect}
        onRefresh={() => {}}
      />
    )
    await userEvent.setup().click(screen.getByText('연결 해제'))
    expect(onDisconnect).toHaveBeenCalled()
  })

  it('사용자 지정 선택 + 정수 입력 → onConnect 가 그 정수 bitrate 로 호출', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: false }}
        onConnect={onConnect}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )

    // 비트레이트 드롭다운에서 "사용자 지정…" 선택
    await user.selectOptions(screen.getByLabelText('비트레이트'), 'custom')
    // 정수 입력
    const input = screen.getByLabelText('사용자 지정(bps)')
    await user.type(input, '83333')

    await user.click(screen.getByText('연결'))
    expect(onConnect).toHaveBeenCalledWith(0, 0, 83333)
  })

  it('사용자 지정 모드에서 빈/비정수 입력이면 연결 버튼 비활성 + 오류 표시', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: false }}
        onConnect={onConnect}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )

    await user.selectOptions(screen.getByLabelText('비트레이트'), 'custom')

    // 빈 입력 → 연결 버튼 비활성, 오류 메시지 노출
    const connectBtn = screen.getByText('연결')
    expect(connectBtn).toBeDisabled()
    expect(screen.getByText('비트레이트는 양의 정수(bps)여야 합니다.')).toBeInTheDocument()

    // 음수 입력도 무효 (number input 의 '-' 타이핑은 jsdom 에서 불안정 → change 로 원자적 설정)
    fireEvent.change(screen.getByLabelText('사용자 지정(bps)'), { target: { value: '-5' } })
    expect(screen.getByText('연결')).toBeDisabled()
  })

  it('표준 드롭다운 경로 회귀: 다른 표준값 선택 시 그 값으로 onConnect', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: false }}
        onConnect={onConnect}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )

    await user.selectOptions(screen.getByLabelText('비트레이트'), '250000')
    // 사용자 지정 입력 필드는 표준 모드에서 보이지 않음
    expect(screen.queryByLabelText('사용자 지정(bps)')).not.toBeInTheDocument()

    await user.click(screen.getByText('연결'))
    expect(onConnect).toHaveBeenCalledWith(0, 0, 250000)
  })

  it('장치 0개 + WinUSB 아님 → Zadig 안내 노출, 버튼이 외부 링크 호출', async () => {
    window.canctl = {
      checkDriver: vi.fn().mockResolvedValue({ state: 'wrong-driver', services: ['usbccgp'] }),
      openExternal: vi.fn()
    }
    render(
      <ConnectionBar
        devices={[]}
        status={{ connected: false }}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )
    // 비동기 진단 결과가 반영되어 WinUSB 안내가 떠야 한다
    expect(await screen.findByText(/WinUSB 드라이버가 아닙니다/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByText('Zadig 받기'))
    expect(window.canctl.openExternal).toHaveBeenCalledWith('https://zadig.akeo.ie/')
  })

  it('장치 0개 + 미연결 → 드라이버 상태 조회(checkDriver) 호출', async () => {
    const checkDriver = vi.fn().mockResolvedValue({ state: 'absent', services: [] })
    window.canctl = { checkDriver, openExternal: vi.fn() }
    render(
      <ConnectionBar
        devices={[]}
        status={{ connected: false }}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )
    expect(await screen.findByText(/장치가 보이지 않습니다/)).toBeInTheDocument()
    expect(checkDriver).toHaveBeenCalled()
  })

  it('장치가 있으면 드라이버 진단을 하지 않는다', () => {
    const checkDriver = vi.fn()
    window.canctl = { checkDriver }
    render(
      <ConnectionBar
        devices={devices}
        status={{ connected: false }}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRefresh={() => {}}
      />
    )
    expect(checkDriver).not.toHaveBeenCalled()
  })

  it('영속: 사용자 지정 값 입력 후 재마운트해도 모드/값 유지', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const props = {
      devices,
      status: { connected: false },
      onConnect,
      onDisconnect: () => {},
      onRefresh: () => {}
    }

    const { unmount } = render(<ConnectionBar {...props} />)
    await user.selectOptions(screen.getByLabelText('비트레이트'), 'custom')
    await user.type(screen.getByLabelText('사용자 지정(bps)'), '83333')
    unmount()

    // 재마운트 — localStorage 에서 복원되어야 함
    render(<ConnectionBar {...props} />)
    const input = screen.getByLabelText('사용자 지정(bps)')
    expect(input).toHaveValue(83333)

    await user.click(screen.getByText('연결'))
    expect(onConnect).toHaveBeenCalledWith(0, 0, 83333)
  })
})
