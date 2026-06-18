import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatusBadge from './StatusBadge'

describe('StatusBadge', () => {
  it('연결 상태 라벨을 표시한다', () => {
    render(<StatusBadge connState="open" status={null} />)
    expect(screen.getByText('코어 연결됨')).toBeInTheDocument()
  })

  it('mock 백엔드면 데모 데이터 배지를 명확히 표시한다', () => {
    render(<StatusBadge connState="open" status={{ backend: 'mock', connected: true }} />)
    expect(screen.getByText('데모 데이터(mock)')).toBeInTheDocument()
  })

  it('실장비(canalystii)는 데모 배지 없이 backend 이름을 표시한다', () => {
    render(<StatusBadge connState="open" status={{ backend: 'canalystii', connected: true }} />)
    expect(screen.queryByText('데모 데이터(mock)')).not.toBeInTheDocument()
    expect(screen.getByText('canalystii')).toBeInTheDocument()
  })
})
