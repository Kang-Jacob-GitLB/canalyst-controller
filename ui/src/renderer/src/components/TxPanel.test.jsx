import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TxPanel from './TxPanel'

describe('TxPanel', () => {
  it('연결 상태에서 기본 입력 송신 → onSend(0x123, [0x11,0x22,0x33])', async () => {
    const onSend = vi.fn()
    render(<TxPanel status={{ connected: true }} onSend={onSend} />)
    await userEvent.setup().click(screen.getByText('송신'))
    expect(onSend).toHaveBeenCalledWith({
      channel: 0, can_id: 0x123, extended: false, rtr: false, data: [0x11, 0x22, 0x33]
    })
  })

  it('미연결 시 송신 버튼이 비활성화된다', () => {
    render(<TxPanel status={{ connected: false }} onSend={() => {}} />)
    expect(screen.getByText('송신')).toBeDisabled()
  })

  it('잘못된 데이터는 오류를 표시하고 onSend 를 호출하지 않는다', async () => {
    const onSend = vi.fn()
    render(<TxPanel status={{ connected: true }} onSend={onSend} />)
    const user = userEvent.setup()
    const dataInput = screen.getByPlaceholderText('11 22 33')
    await user.clear(dataInput)
    await user.type(dataInput, 'ZZ')
    await user.click(screen.getByText('송신'))
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/16진수/)).toBeInTheDocument()
  })

  it('송신 후 송신 피드백(송신됨: ...)을 표시한다', async () => {
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    await userEvent.setup().click(screen.getByText('송신'))
    expect(screen.getByText(/송신됨: 0x123/)).toBeInTheDocument()
  })
})
