import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanSocket } from './useCanSocket'

// 수동 트리거 가짜 WebSocket(다른 테스트와 동일 패턴). 생성자는 인스턴스만 보관.
class FakeWebSocket {
  static OPEN = 1
  static last = null
  static created = 0

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.onopen = null
    this.onclose = null
    this.onerror = null
    this.onmessage = null
    FakeWebSocket.last = this
    FakeWebSocket.created += 1
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
}

describe('useCanSocket 자동 재연결', () => {
  beforeEach(() => {
    FakeWebSocket.last = null
    FakeWebSocket.created = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('연결이 닫히면 잠시 뒤 새 WebSocket 으로 재연결한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const first = FakeWebSocket.last
    act(() => first._open())
    expect(result.current.connState).toBe('open')

    // 데몬 소실 모사: 연결 닫힘 → 'closed' + 재연결 예약
    act(() => first.close())
    expect(result.current.connState).toBe('closed')

    // 1초 후 재연결 시도 → 새 인스턴스 생성(take-over 된 새 데몬에 다시 붙음)
    act(() => vi.advanceTimersByTime(1000))
    const second = FakeWebSocket.last
    expect(second).not.toBe(first)
    expect(FakeWebSocket.created).toBe(2)

    act(() => second._open())
    expect(result.current.connState).toBe('open')
  })

  it('언마운트 후에는 재연결하지 않는다', () => {
    const { result, unmount } = renderHook(() => useCanSocket('ws://x'))
    const first = FakeWebSocket.last
    act(() => first._open())
    unmount()
    act(() => vi.advanceTimersByTime(5000))
    // 언마운트 시 disposed=true + 타이머 정리 → 추가 인스턴스 없음
    expect(FakeWebSocket.created).toBe(1)
  })
})
