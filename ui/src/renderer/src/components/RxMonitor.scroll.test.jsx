import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import RxMonitor from './RxMonitor'

// '맨 아래로' 플로팅 버튼 테스트.
// jsdom 은 레이아웃이 없어 스크롤 측정값(scrollHeight/clientHeight)이 0 이므로,
// 해당 값을 직접 정의해 "위로 스크롤한 상태"를 만들어 버튼 등장/동작을 검증한다.
function mockScrollMetrics(el, { scrollHeight, clientHeight, scrollTop }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
}

const frame = (seq) => ({
  _seq: seq,
  ts: seq,
  channel: 0,
  can_id: 0x100,
  extended: false,
  rtr: false,
  dlc: 1,
  data: [seq & 0xff]
})

const BTN = '맨 아래로 스크롤'

describe('RxMonitor 맨 아래로 버튼', () => {
  it('초기(하단 추종 중)엔 버튼이 보이지 않는다', () => {
    render(<RxMonitor frames={[frame(1)]} onClear={() => {}} />)
    expect(screen.queryByRole('button', { name: BTN })).not.toBeInTheDocument()
  })

  it('위로 스크롤하면 버튼이 나타나고, 클릭하면 최하단으로 이동하며 버튼이 사라진다', () => {
    render(<RxMonitor frames={[frame(1), frame(2), frame(3)]} onClear={() => {}} />)
    const wrap = document.querySelector('.rx-table-wrap')

    // 바닥에서 800px 위로 올라간 상태(임계 60px 초과)
    mockScrollMetrics(wrap, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
    fireEvent.scroll(wrap)

    const btn = screen.getByRole('button', { name: BTN })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)
    expect(wrap.scrollTop).toBe(1000) // scrollHeight 로 이동(최하단)
    expect(screen.queryByRole('button', { name: BTN })).not.toBeInTheDocument()
  })
})
