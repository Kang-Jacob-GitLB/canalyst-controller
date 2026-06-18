import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ConnectionBar from './ConnectionBar'

const devices = [{ index: 0, name: 'Mock CANalyst-II', channels: 2 }]

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
})
