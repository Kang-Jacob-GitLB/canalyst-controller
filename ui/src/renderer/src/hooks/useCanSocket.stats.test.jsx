import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanSocket } from './useCanSocket'

// 누적 수신 통계 전용 테스트. frames 의 500개 캡과 무관하게 누적 카운트가
// 유지되는지(정확도 핵심), TX 에코 제외, 리셋 동작을 검증한다.

// jsdom 에 WebSocket 이 없으므로 가짜 클래스를 주입(기존 테스트와 동일 패턴).
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

const rxFrame = (over = {}) => ({
  ts: 1.0,
  channel: 0,
  can_id: 0x100,
  extended: false,
  rtr: false,
  dlc: 1,
  data: [0x01],
  ...over
})
const rxMsg = (frames) => ({ type: 'rx', frames })

describe('useCanSocket 누적 통계', () => {
  beforeEach(() => {
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('초기 통계는 0/빈 객체/레이트 0', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    expect(result.current.stats).toEqual({ total: 0, byId: {}, rate: 0 })
  })

  it('500프레임 캡을 초과해도 누적 total·byId 카운트가 유지된다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    // 600개를 한 배치로 주입 → frames 는 500으로 잘리지만 통계는 600 누적
    const batch = Array.from({ length: 600 }, (_, i) =>
      rxFrame({ can_id: i % 3 === 0 ? 0x100 : 0x200 })
    )
    act(() => ws._message(rxMsg(batch)))

    // frames 는 500 캡
    expect(result.current.frames).toHaveLength(500)
    // 통계는 600 전체 누적(캡 영향 없음)
    expect(result.current.stats.total).toBe(600)

    // can_id 분포: i%3===0 → 0x100 (i=0,3,...,597 → 200개), 나머지 400개 → 0x200
    const id100 = result.current.stats.byId[0x100]
    const id200 = result.current.stats.byId[0x200]
    expect(id100 + id200).toBe(600)
    expect(id100).toBe(200)
    expect(id200).toBe(400)
  })

  it('여러 배치에 걸쳐 누적되고 고유 ID 수(byId 키)가 늘어난다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message(rxMsg([rxFrame({ can_id: 0x111 }), rxFrame({ can_id: 0x222 })])))
    act(() => ws._message(rxMsg([rxFrame({ can_id: 0x111 }), rxFrame({ can_id: 0x333 })])))

    expect(result.current.stats.total).toBe(4)
    expect(result.current.stats.byId[0x111]).toBe(2)
    expect(result.current.stats.byId[0x222]).toBe(1)
    expect(result.current.stats.byId[0x333]).toBe(1)
    expect(Object.keys(result.current.stats.byId)).toHaveLength(3)
  })

  it('TX 에코(dir==="tx")는 수신 통계에서 제외한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() =>
      ws._message(
        rxMsg([
          rxFrame({ can_id: 0x100 }), // rx
          rxFrame({ can_id: 0x100, dir: 'tx' }), // tx 에코 → 제외
          rxFrame({ can_id: 0x200 }) // rx
        ])
      )
    )

    // rx 만 카운트 → total 2, 0x100 은 1회
    expect(result.current.stats.total).toBe(2)
    expect(result.current.stats.byId[0x100]).toBe(1)
    expect(result.current.stats.byId[0x200]).toBe(1)
  })

  it('resetStats 는 누적 통계를 초기값으로 되돌린다(frames 는 건드리지 않는다)', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message(rxMsg([rxFrame(), rxFrame()])))
    expect(result.current.stats.total).toBe(2)
    expect(result.current.frames).toHaveLength(2)

    act(() => result.current.resetStats())
    expect(result.current.stats).toEqual({ total: 0, byId: {}, rate: 0 })
    // frames 는 리셋과 무관하게 유지
    expect(result.current.frames).toHaveLength(2)
  })

  it('레이트는 수신 시 0보다 큰 값으로 갱신된다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message(rxMsg([rxFrame(), rxFrame(), rxFrame()])))
    // 윈도우(1초) 내 3개 → 3 msg/s
    expect(result.current.stats.rate).toBeGreaterThan(0)
  })
})
