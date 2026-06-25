import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
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

  describe('주기 송신', () => {
    afterEach(() => {
      // fake timers 를 다음 테스트로 누수시키지 않는다
      vi.useRealTimers()
    })

    it('주기 송신을 켜면 주기마다 onSend 가 반복 호출된다', () => {
      vi.useFakeTimers()
      const onSend = vi.fn()
      render(<TxPanel status={{ connected: true }} onSend={onSend} />)

      // 주기 송신 토글 ON (기본 주기 1000ms)
      fireEvent.click(screen.getByLabelText('주기 송신'))

      // setInterval 첫 호출은 1주기 뒤이므로 3주기 진행 → 3회 기대
      act(() => vi.advanceTimersByTime(3000))
      expect(onSend).toHaveBeenCalledTimes(3)
      expect(onSend).toHaveBeenLastCalledWith({
        channel: 0, can_id: 0x123, extended: false, rtr: false, data: [0x11, 0x22, 0x33]
      })
    })

    it('주기 송신을 끄면 더 이상 호출되지 않는다', () => {
      vi.useFakeTimers()
      const onSend = vi.fn()
      render(<TxPanel status={{ connected: true }} onSend={onSend} />)

      const toggle = screen.getByLabelText('주기 송신')
      fireEvent.click(toggle) // ON
      act(() => vi.advanceTimersByTime(2000))
      expect(onSend).toHaveBeenCalledTimes(2)

      fireEvent.click(toggle) // OFF → clearInterval
      act(() => vi.advanceTimersByTime(5000))
      expect(onSend).toHaveBeenCalledTimes(2) // 변화 없음
    })

    it('미연결 상태에서는 주기 송신이 동작하지 않는다', () => {
      vi.useFakeTimers()
      const onSend = vi.fn()
      render(<TxPanel status={{ connected: false }} onSend={onSend} />)

      fireEvent.click(screen.getByLabelText('주기 송신'))
      act(() => vi.advanceTimersByTime(5000))
      expect(onSend).not.toHaveBeenCalled()
    })

    it('연결이 끊기면 주기 송신이 멈춘다', () => {
      vi.useFakeTimers()
      const onSend = vi.fn()
      const { rerender } = render(<TxPanel status={{ connected: true }} onSend={onSend} />)

      fireEvent.click(screen.getByLabelText('주기 송신'))
      act(() => vi.advanceTimersByTime(2000))
      expect(onSend).toHaveBeenCalledTimes(2)

      // 연결 해제 → cleanup 이 interval 제거
      rerender(<TxPanel status={{ connected: false }} onSend={onSend} />)
      act(() => vi.advanceTimersByTime(5000))
      expect(onSend).toHaveBeenCalledTimes(2)
    })
  })

  describe('송신 프리셋', () => {
    it('현재 폼을 프리셋으로 저장하고 목록에 표시한다', async () => {
      const user = userEvent.setup()
      render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

      await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '테스트1')
      await user.click(screen.getByText('프리셋 저장'))

      expect(screen.getByText('테스트1')).toBeInTheDocument()
    })

    it('프리셋을 로드하면 폼 값이 채워진다', async () => {
      const user = userEvent.setup()
      render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

      // 폼을 특정 값으로 바꾸고 저장
      const idInput = screen.getByLabelText('ID(hex)')
      await user.clear(idInput)
      await user.type(idInput, '7DF')
      await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '진단요청')
      await user.click(screen.getByText('프리셋 저장'))

      // 폼을 다른 값으로 바꿔놓고
      await user.clear(idInput)
      await user.type(idInput, '000')
      expect(idInput).toHaveValue('000')

      // 프리셋 로드 → 7DF 가 복원됨
      await user.click(screen.getByRole('button', { name: '로드' }))
      expect(idInput).toHaveValue('7DF')
    })

    it('프리셋을 삭제하면 목록에서 사라진다', async () => {
      const user = userEvent.setup()
      render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

      await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '삭제대상')
      await user.click(screen.getByText('프리셋 저장'))
      expect(screen.getByText('삭제대상')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '삭제' }))
      expect(screen.queryByText('삭제대상')).not.toBeInTheDocument()
    })

    it('재전송은 폼 state 가 아니라 프리셋 값으로 즉시 송신한다', async () => {
      const onSend = vi.fn()
      const user = userEvent.setup()
      render(<TxPanel status={{ connected: true }} onSend={onSend} />)

      // 폼을 7DF 로 설정해 프리셋 저장
      const idInput = screen.getByLabelText('ID(hex)')
      await user.clear(idInput)
      await user.type(idInput, '7DF')
      await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '진단요청')
      await user.click(screen.getByText('프리셋 저장'))

      // 폼을 다른 값(000)으로 바꿔도 재전송은 프리셋(7DF)을 보낸다
      await user.clear(idInput)
      await user.type(idInput, '000')

      await user.click(screen.getByRole('button', { name: '재전송' }))
      expect(onSend).toHaveBeenCalledWith(
        expect.objectContaining({ can_id: 0x7df })
      )
    })

    it('빈 이름으로 저장하면 오류를 표시하고 저장하지 않는다', async () => {
      const user = userEvent.setup()
      render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

      await user.click(screen.getByText('프리셋 저장'))
      // 라벨("프리셋 이름")과 겹치지 않도록 오류 문구만 정확히 매칭
      expect(screen.getByText('프리셋 이름을 입력하세요')).toBeInTheDocument()
    })
  })
})
