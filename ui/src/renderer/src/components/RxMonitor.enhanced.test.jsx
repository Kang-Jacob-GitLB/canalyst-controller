import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import RxMonitor from './RxMonitor'

// RxMonitor 강화 기능(검색·일시정지·ID별 집계뷰·CSV 내보내기) 테스트.
// 기존 RxMonitor.test.jsx 의 기본 동작 테스트와 별개로 추가 기능만 검증한다.

const frame = (over = {}) => ({
  _seq: 1,
  ts: 1.234,
  channel: 0,
  can_id: 0x100,
  extended: false,
  rtr: false,
  dlc: 2,
  data: [0xab, 0xcd],
  ...over
})

describe('RxMonitor 검색/필터', () => {
  it('CAN ID(hex) 부분일치로 행을 거른다', async () => {
    const frames = [
      frame({ _seq: 1, can_id: 0x123, data: [0x11] }),
      frame({ _seq: 2, can_id: 0x456, data: [0x22] })
    ]
    render(<RxMonitor frames={frames} onClear={() => {}} />)

    // 검색 전엔 둘 다 보인다
    expect(screen.getByText('0x123')).toBeInTheDocument()
    expect(screen.getByText('0x456')).toBeInTheDocument()

    await userEvent.setup().type(screen.getByPlaceholderText(/검색/), '123')
    expect(screen.getByText('0x123')).toBeInTheDocument()
    expect(screen.queryByText('0x456')).not.toBeInTheDocument()
  })

  it('data(hex) 부분일치로도 거른다', async () => {
    const frames = [
      frame({ _seq: 1, can_id: 0x100, data: [0xde, 0xad] }),
      frame({ _seq: 2, can_id: 0x200, data: [0xbe, 0xef] })
    ]
    render(<RxMonitor frames={frames} onClear={() => {}} />)

    await userEvent.setup().type(screen.getByPlaceholderText(/검색/), 'dead')
    expect(screen.getByText('0x100')).toBeInTheDocument()
    expect(screen.queryByText('0x200')).not.toBeInTheDocument()
  })

  it('0x 접두·대소문자를 무시하고 매칭한다', async () => {
    const frames = [frame({ _seq: 1, can_id: 0x1ab })]
    render(<RxMonitor frames={frames} onClear={() => {}} />)
    await userEvent.setup().type(screen.getByPlaceholderText(/검색/), '0x1AB')
    expect(screen.getByText('0x1AB')).toBeInTheDocument()
  })

  it('일치하는 프레임이 없으면 안내 메시지를 표시한다', async () => {
    render(<RxMonitor frames={[frame({ can_id: 0x100 })]} onClear={() => {}} />)
    await userEvent.setup().type(screen.getByPlaceholderText(/검색/), '999')
    expect(screen.getByText(/검색 조건에 맞는 프레임이 없습니다/)).toBeInTheDocument()
  })
})

describe('RxMonitor 일시정지', () => {
  it('일시정지 시 새 프레임이 와도 표시가 스냅샷에 고정되고 표식이 뜬다', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <RxMonitor frames={[frame({ _seq: 1, can_id: 0x111 })]} onClear={() => {}} />
    )
    expect(screen.getByText('0x111')).toBeInTheDocument()

    // 일시정지 진입
    await user.click(screen.getByRole('button', { name: '일시정지' }))
    expect(screen.getByText(/일시정지됨/)).toBeInTheDocument()

    // 라이브 frames 가 갱신돼도 스냅샷이 유지되어 새 프레임은 보이지 않는다
    rerender(
      <RxMonitor
        frames={[frame({ _seq: 1, can_id: 0x111 }), frame({ _seq: 2, can_id: 0x222 })]}
        onClear={() => {}}
      />
    )
    expect(screen.getByText('0x111')).toBeInTheDocument()
    expect(screen.queryByText('0x222')).not.toBeInTheDocument()

    // 재개하면 라이브로 복귀
    await user.click(screen.getByRole('button', { name: '재개' }))
    expect(screen.queryByText(/일시정지됨/)).not.toBeInTheDocument()
    expect(screen.getByText('0x222')).toBeInTheDocument()
  })
})

describe('RxMonitor ID별 집계뷰', () => {
  it('집계뷰로 토글하면 같은 ID 가 1행으로 묶이고 카운트가 표시된다', async () => {
    const frames = [
      frame({ _seq: 1, can_id: 0x100, data: [0x01] }),
      frame({ _seq: 2, can_id: 0x100, data: [0x02] }),
      frame({ _seq: 3, can_id: 0x200, data: [0x03] })
    ]
    render(<RxMonitor frames={frames} onClear={() => {}} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'ID별 집계' }))

    // 집계뷰 헤더 등장
    expect(screen.getByText(/카운트\(현재 창\)/)).toBeInTheDocument()
    // 0x100 행: 카운트 2, 최신 데이터(02)
    const rows = screen.getAllByRole('row')
    // 0x100 을 포함한 행을 찾아 카운트 2 확인
    const id100Row = rows.find((r) => within(r).queryByText('0x100'))
    expect(id100Row).toBeTruthy()
    expect(within(id100Row).getByText('2')).toBeInTheDocument()
    // 최신 데이터(가장 마지막 프레임의 data=02)
    expect(within(id100Row).getByText('02')).toBeInTheDocument()
  })

  it('로그 뷰로 다시 토글하면 경과 컬럼이 돌아온다', async () => {
    const user = userEvent.setup()
    render(<RxMonitor frames={[frame()]} onClear={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'ID별 집계' }))
    expect(screen.queryByText('경과(s)')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '로그 뷰' }))
    expect(screen.getByText('경과(s)')).toBeInTheDocument()
  })
})

describe('RxMonitor CSV 내보내기', () => {
  beforeEach(() => {
    // jsdom 에 없는 URL.createObjectURL/revokeObjectURL 을 stub
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn()
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('CSV 내보내기 버튼 클릭 시 다운로드(<a download> 클릭)를 트리거한다', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<RxMonitor frames={[frame()]} onClear={() => {}} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'CSV 내보내기' }))
    expect(clickSpy).toHaveBeenCalled()
    expect(URL.createObjectURL).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('프레임이 없으면 다운로드를 트리거하지 않는다', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<RxMonitor frames={[]} onClear={() => {}} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'CSV 내보내기' }))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})

describe('RxMonitor 표시 상한', () => {
  it('표시 상한을 100으로 낮추면 최신 100행만 렌더한다', async () => {
    // 150개 프레임(can_id 로 식별), 기본 500 → 전부 보이다가 100 으로 제한
    const frames = Array.from({ length: 150 }, (_, i) =>
      frame({ _seq: i + 1, can_id: 0x100 + i })
    )
    render(<RxMonitor frames={frames} onClear={() => {}} />)

    // 기본 상한(500)에선 첫 프레임(0x100)도 보인다
    expect(screen.getByText('0x100')).toBeInTheDocument()

    await userEvent.setup().selectOptions(screen.getByRole('combobox'), '100')
    // 최신 100개만 → 가장 오래된 0x100 은 사라지고 최신 0x195(0x100+149) 는 보인다
    expect(screen.queryByText('0x100')).not.toBeInTheDocument()
    expect(screen.getByText('0x195')).toBeInTheDocument()
  })
})
