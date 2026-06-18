import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import RxMonitor from './RxMonitor'

const frame = (over = {}) => ({
  _seq: 1, ts: 1.234, channel: 0, can_id: 0x100,
  extended: false, rtr: false, dlc: 2, data: [0xab, 0xcd], ...over
})

describe('RxMonitor', () => {
  it('빈 상태 메시지를 표시한다', () => {
    render(<RxMonitor frames={[]} onClear={() => {}} />)
    expect(screen.getByText(/수신된 프레임이 없습니다/)).toBeInTheDocument()
    expect(screen.getByText(/수신 모니터 \(0\)/)).toBeInTheDocument()
  })

  it('프레임 행을 렌더하고 ID·데이터를 16진수로 포맷한다', () => {
    render(<RxMonitor frames={[frame()]} onClear={() => {}} />)
    expect(screen.getByText('0x100')).toBeInTheDocument()
    expect(screen.getByText('AB CD')).toBeInTheDocument()
    expect(screen.getByText('STD')).toBeInTheDocument()
    expect(screen.getByText(/수신 모니터 \(1\)/)).toBeInTheDocument()
  })

  it('확장 프레임은 8자리 ID와 EXT로 표시한다', () => {
    render(<RxMonitor frames={[frame({ can_id: 0x18ff50e5, extended: true })]} onClear={() => {}} />)
    expect(screen.getByText('0x18FF50E5')).toBeInTheDocument()
    expect(screen.getByText('EXT')).toBeInTheDocument()
  })

  it('지우기 버튼이 onClear를 호출한다', async () => {
    const onClear = vi.fn()
    render(<RxMonitor frames={[frame()]} onClear={onClear} />)
    await userEvent.setup().click(screen.getByText('지우기'))
    expect(onClear).toHaveBeenCalled()
  })
})
