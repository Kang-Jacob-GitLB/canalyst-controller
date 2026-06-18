import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ToolsPanel from './ToolsPanel'

const noop = () => {}
const baseProps = {
  filterIds: null,
  logStatus: null,
  onSetFilter: noop,
  onStartLog: noop,
  onStopLog: noop,
  onReplay: noop,
  onLoadDbc: noop
}

describe('ToolsPanel', () => {
  it('hex 콤마구분 입력을 정수 배열로 파싱해 onSetFilter 를 호출한다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    // 트레일링 콤마/여분 공백이 있어도 빈 토큰을 버리고 파싱
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), '100, 7FF, ')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).toHaveBeenCalledWith([0x100, 0x7ff])
  })

  it('빈 입력은 전체 통과(빈 배열)로 전송한다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    await userEvent.setup().click(screen.getByText('필터 적용'))
    expect(onSetFilter).toHaveBeenCalledWith([])
  })

  it('잘못된 hex 는 오류를 표시하고 onSetFilter 를 호출하지 않는다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), 'ZZZ')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).not.toHaveBeenCalled()
    expect(screen.getByText(/잘못된 ID/)).toBeInTheDocument()
  })

  it('현재 필터를 hex 로 라운드트립 표시한다(빈 배열은 전체 통과)', () => {
    const { rerender } = render(<ToolsPanel {...baseProps} filterIds={[0x100, 0x7ff]} />)
    expect(screen.getByText(/100, 7FF/)).toBeInTheDocument()
    rerender(<ToolsPanel {...baseProps} filterIds={[]} />)
    expect(screen.getByText(/전체 통과/)).toBeInTheDocument()
  })

  it('로깅 중이면 중지 버튼과 기록 상태를 표시한다', () => {
    render(<ToolsPanel {...baseProps} logStatus={{ logging: true, path: '/tmp/a.log' }} />)
    expect(screen.getByText('로깅 중지')).toBeInTheDocument()
    expect(screen.getByText(/기록 중/)).toBeInTheDocument()
  })
})
