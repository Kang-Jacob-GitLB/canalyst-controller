import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// useCanSocket.test.jsx 와 동일한 가짜 WebSocket: 생성자에서 핸들러를 자동
// 호출하지 않고 인스턴스만 보관해, 테스트가 act() 안에서 수동으로 이벤트를 트리거한다.
class FakeWebSocket {
  static OPEN = 1
  static last = null

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.onopen = null
    this.onclose = null
    this.onerror = null
    this.onmessage = null
    FakeWebSocket.last = this
  }
  send(data) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
  _open() {
    this.readyState = FakeWebSocket.OPEN
    if (this.onopen) this.onopen()
  }
  _message(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) })
  }
}

describe('App 에러 패널', () => {
  beforeEach(() => {
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('같은 에러가 또 오면 패널이 재마운트되어(새 에러로 인지) enter 애니메이션이 재실행된다', () => {
    const { container } = render(<App />)
    const ws = FakeWebSocket.last
    act(() => ws._open())

    // 초기엔 에러 패널이 없다
    expect(container.querySelector('.app-error')).toBeNull()

    // 첫 에러 → 패널 등장
    act(() => ws._message({ type: 'error', message: 'replay 실패: 파일 없음' }))
    const panel1 = container.querySelector('.app-error')
    expect(panel1).not.toBeNull()
    expect(panel1.textContent).toContain('replay 실패: 파일 없음')
    expect(panel1.getAttribute('role')).toBe('alert')

    // 같은 메시지가 또 옴 → key(errorSeq) 가 바뀌어 새 DOM 노드로 재마운트된다.
    // 재마운트는 곧 CSS enter 애니메이션(app-error-pulse)의 재실행을 의미한다.
    act(() => ws._message({ type: 'error', message: 'replay 실패: 파일 없음' }))
    const panel2 = container.querySelector('.app-error')
    expect(panel2).not.toBeNull()
    expect(panel2).not.toBe(panel1) // 다른 노드 = 재마운트됨
  })

  it('X 아이콘 버튼으로 에러 패널을 닫는다', () => {
    const { container } = render(<App />)
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message({ type: 'error', message: '테스트 에러' }))
    expect(container.querySelector('.app-error')).not.toBeNull()

    const closeBtn = container.querySelector('.app-error-close')
    expect(closeBtn).not.toBeNull()
    expect(closeBtn.getAttribute('aria-label')).toBe('오류 닫기')

    act(() => fireEvent.click(closeBtn))
    expect(container.querySelector('.app-error')).toBeNull()
  })
})
