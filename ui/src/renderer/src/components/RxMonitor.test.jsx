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

  it('첫 프레임 기준 상대 경과초로 ts 를 표시한다(거대한 mock epoch도 작게)', () => {
    // mock 백엔드의 거대한 epoch초(약 1.75e9)도 t0 를 빼면 작은 상대값이 된다.
    const t0 = 1_750_000_000.0
    render(
      <RxMonitor
        frames={[
          frame({ _seq: 1, ts: t0 }),
          frame({ _seq: 2, ts: t0 + 0.102 })
        ]}
        onClear={() => {}}
      />
    )
    // 거대한 raw epoch 숫자는 화면에 나타나지 않는다
    expect(screen.queryByText(String(t0))).not.toBeInTheDocument()
    // 첫 프레임은 +0.000, 다음 프레임은 +0.102
    expect(screen.getByText('+0.000')).toBeInTheDocument()
    expect(screen.getByText('+0.102')).toBeInTheDocument()
  })

  it('500개 상한으로 첫 프레임이 밀려나도 t0 앵커가 흔들리지 않는다', () => {
    const t0 = 1_750_000_000.0
    const a = frame({ _seq: 1, ts: t0 })
    const b = frame({ _seq: 2, ts: t0 + 0.102 })
    const { rerender } = render(<RxMonitor frames={[a, b]} onClear={() => {}} />)

    // 윈도우 슬라이드 모사: a 가 밀려나고 b, c 만 남음(c 는 t0+61 → m:ss 분기)
    const c = frame({ _seq: 3, ts: t0 + 61 })
    rerender(<RxMonitor frames={[b, c]} onClear={() => {}} />)

    // t0 가 frames[0] 에서 재계산됐다면 b 가 +0.000 이 되어버린다 → 앵커 불변 확인
    expect(screen.getByText('+0.102')).toBeInTheDocument()
    // 60초 이상은 분:초.밀리초(m:ss.mmm) 분기로 표시
    expect(screen.getByText('1:01.000')).toBeInTheDocument()
  })

  it('decoded 가 있으면 메시지명과 신호를 서브행으로 표시한다', () => {
    const decoded = { message: 'EngineData', signals: { Rpm: 1200, Temp: 90 } }
    render(<RxMonitor frames={[frame({ decoded })]} onClear={() => {}} />)
    expect(screen.getByText('EngineData')).toBeInTheDocument()
    expect(screen.getByText('Rpm=1200, Temp=90')).toBeInTheDocument()
  })

  it('decoded 가 없으면 디코딩 서브행을 렌더하지 않는다', () => {
    render(<RxMonitor frames={[frame()]} onClear={() => {}} />)
    expect(document.querySelector('.decoded-row')).toBeNull()
  })
})
