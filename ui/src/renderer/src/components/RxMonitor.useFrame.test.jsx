import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import RxMonitor from './RxMonitor'

// 모니터 행 더블클릭 → onUseFrame 호출(행→TX 폼 채우기) 테스트.
// 핵심 계약: onUseFrame 인자는 TxPanel.buildFrame 입력과 정확히 왕복되는 객체
// (canId 는 "0x" 없는 hex 문자열, dataStr 은 공백 구분 hex 바이트).

const frame = (over = {}) => ({
  _seq: 1,
  ts: 1.234,
  channel: 0,
  can_id: 0x123,
  extended: false,
  rtr: false,
  dlc: 3,
  data: [0x11, 0x22, 0x33],
  ...over
})

describe('RxMonitor 행→TX 폼 채우기(onUseFrame)', () => {
  it('표준 프레임 행을 더블클릭하면 0x 없는 ID·공백 hex 데이터로 onUseFrame 을 호출한다', async () => {
    const onUseFrame = vi.fn()
    render(<RxMonitor frames={[frame()]} onClear={() => {}} onUseFrame={onUseFrame} />)

    // 0x123 셀이 속한 프레임 행을 더블클릭(셀 더블클릭이 행 핸들러로 버블링)
    await userEvent.setup().dblClick(screen.getByText('0x123'))

    expect(onUseFrame).toHaveBeenCalledTimes(1)
    expect(onUseFrame).toHaveBeenCalledWith({
      canId: '123',
      channel: 0,
      extended: false,
      rtr: false,
      dataStr: '11 22 33'
    })
  })

  it('확장 프레임은 0x 없는 8자리 hex ID·extended=true 로 넘긴다', async () => {
    const onUseFrame = vi.fn()
    render(
      <RxMonitor
        frames={[frame({ can_id: 0x18ff50e5, extended: true, channel: 1, data: [0xde, 0xad] })]}
        onClear={() => {}}
        onUseFrame={onUseFrame}
      />
    )

    await userEvent.setup().dblClick(screen.getByText('0x18FF50E5'))

    expect(onUseFrame).toHaveBeenCalledWith({
      canId: '18FF50E5',
      channel: 1,
      extended: true,
      rtr: false,
      dataStr: 'DE AD'
    })
  })

  it('RTR 프레임은 rtr=true, 빈 데이터는 빈 문자열로 넘긴다', async () => {
    const onUseFrame = vi.fn()
    render(
      <RxMonitor
        frames={[frame({ can_id: 0x7df, rtr: true, dlc: 0, data: [] })]}
        onClear={() => {}}
        onUseFrame={onUseFrame}
      />
    )

    await userEvent.setup().dblClick(screen.getByText('0x7DF'))

    expect(onUseFrame).toHaveBeenCalledWith({
      canId: '7DF',
      channel: 0,
      extended: false,
      rtr: true,
      dataStr: ''
    })
  })

  it('onUseFrame 이 없으면 더블클릭해도 오류 없이 무시한다', async () => {
    // onUseFrame 미전달(기존 마운트 호환). 더블클릭이 throw 하지 않아야 한다.
    render(<RxMonitor frames={[frame()]} onClear={() => {}} />)
    await userEvent.setup().dblClick(screen.getByText('0x123'))
    // 여기까지 예외 없이 도달하면 통과
    expect(screen.getByText('0x123')).toBeInTheDocument()
  })

  it('더블클릭 송신 힌트(title)를 행에 표시한다', () => {
    render(<RxMonitor frames={[frame()]} onClear={() => {}} onUseFrame={() => {}} />)
    const row = screen.getByText('0x123').closest('tr')
    expect(row.getAttribute('title')).toContain('더블클릭')
  })
})
