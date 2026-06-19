import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StatsPanel from './StatsPanel'

describe('StatsPanel', () => {
  it('총 프레임·고유 ID·레이트를 표시한다', () => {
    const stats = { total: 42, byId: { 256: 30, 512: 12 }, rate: 7.4 }
    render(<StatsPanel stats={stats} onReset={() => {}} />)

    expect(screen.getByText('42')).toBeInTheDocument() // 총 프레임
    expect(screen.getByText('2')).toBeInTheDocument() // 고유 ID(byId 키 개수)
    expect(screen.getByText('7 msg/s')).toBeInTheDocument() // 레이트(반올림)
  })

  it('ID별 카운트를 16진수로, 카운트 내림차순으로 표시한다', () => {
    const stats = { total: 42, byId: { 256: 30, 512: 12 }, rate: 0 }
    render(<StatsPanel stats={stats} onReset={() => {}} />)
    expect(screen.getByText('0x100')).toBeInTheDocument() // 256
    expect(screen.getByText('0x200')).toBeInTheDocument() // 512
  })

  it('확장 ID(0x7FF 초과)는 8자리로 표시한다', () => {
    const stats = { total: 1, byId: { [0x18ff50e5]: 1 }, rate: 0 }
    render(<StatsPanel stats={stats} onReset={() => {}} />)
    expect(screen.getByText('0x18FF50E5')).toBeInTheDocument()
  })

  it('통계 초기화 버튼이 onReset 을 호출한다', async () => {
    const onReset = vi.fn()
    render(<StatsPanel stats={{ total: 0, byId: {}, rate: 0 }} onReset={onReset} />)
    await userEvent.setup().click(screen.getByText('통계 초기화'))
    expect(onReset).toHaveBeenCalled()
  })

  it('byId 가 비면 ID별 표를 렌더하지 않는다', () => {
    render(<StatsPanel stats={{ total: 0, byId: {}, rate: 0 }} onReset={() => {}} />)
    expect(document.querySelector('.stats-byid')).toBeNull()
  })
})
