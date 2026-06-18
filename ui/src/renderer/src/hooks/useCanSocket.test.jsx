import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanSocket } from './useCanSocket'

// jsdom 에는 WebSocket 이 없으므로 가짜 클래스를 전역에 주입한다.
// 훅은 new WebSocket 직후 ws.onopen/onmessage/... 를 할당하므로,
// 생성자에서 자동으로 핸들러를 호출하지 않고(아직 미할당) 인스턴스만 보관해
// 테스트가 act() 안에서 수동으로 이벤트를 트리거한다.
class FakeWebSocket {
  static OPEN = 1
  static last = null

  constructor(url) {
    this.url = url
    this.readyState = 0 // CONNECTING
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
    this.readyState = 3 // CLOSED
    if (this.onclose) this.onclose()
  }

  // 테스트 헬퍼: 연결 성립을 모사한다(readyState=OPEN 후 onopen 호출)
  _open() {
    this.readyState = FakeWebSocket.OPEN
    if (this.onopen) this.onopen()
  }

  // 테스트 헬퍼: 서버 메시지 수신을 모사한다
  _message(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) })
  }
}

// rx 메시지(프레임 배치) 생성 도우미
const rxFrame = (over = {}) => ({
  ts: 1.0, channel: 0, can_id: 0x100,
  extended: false, rtr: false, dlc: 1, data: [0x01], ...over
})
const rxMsg = (frames) => ({ type: 'rx', frames })

describe('useCanSocket', () => {
  beforeEach(() => {
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('연결되면 connState 가 open 이 되고 list_devices 를 자동 전송한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    expect(result.current.connState).toBe('connecting')

    const ws = FakeWebSocket.last
    act(() => ws._open())

    expect(result.current.connState).toBe('open')
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'list_devices' })
  })

  it('status·devices 메시지를 상태로 디스패치한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message({ type: 'status', connected: true, backend: 'mock' }))
    expect(result.current.status).toMatchObject({ connected: true, backend: 'mock' })

    const list = [{ index: 0, name: 'Mock CANalyst-II', channels: 2 }]
    act(() => ws._message({ type: 'devices', list }))
    expect(result.current.devices).toEqual(list)
  })

  it('rx 메시지 수신 시 frames 가 누적되고 각 프레임에 _seq 가 부여된다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message(rxMsg([rxFrame({ can_id: 0x111 }), rxFrame({ can_id: 0x222 })])))
    act(() => ws._message(rxMsg([rxFrame({ can_id: 0x333 })])))

    expect(result.current.frames).toHaveLength(3)
    expect(result.current.frames.map((f) => f.can_id)).toEqual([0x111, 0x222, 0x333])
    // _seq 는 0 부터 단조 증가
    expect(result.current.frames.map((f) => f._seq)).toEqual([0, 1, 2])
  })

  it('frames 는 500개 상한을 유지하며 가장 최근 프레임이 남는다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    // 한 배치에 600개 → 상한 초과
    const batch1 = Array.from({ length: 600 }, (_, i) => rxFrame({ can_id: i }))
    act(() => ws._message(rxMsg(batch1)))
    expect(result.current.frames).toHaveLength(500)

    // 추가 배치 후에도 상한 유지 + 꼬리(최신)가 살아있는지 확인
    act(() => ws._message(rxMsg([rxFrame({ can_id: 0xabc })])))
    expect(result.current.frames).toHaveLength(500)
    const lastFrame = result.current.frames[result.current.frames.length - 1]
    expect(lastFrame.can_id).toBe(0xabc)
  })

  it('error 메시지를 상태에 담고 clearError 로 해제한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message({ type: 'error', message: '연결 실패' }))
    expect(result.current.error).toBe('연결 실패')

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it('connect 는 OPEN 상태에서 connect 명령을 전송한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open()) // readyState = OPEN

    act(() => result.current.connect(0, 1, 500000))
    // sent[0] 은 자동 list_devices, sent[1] 이 connect
    expect(JSON.parse(ws.sent[1])).toEqual({
      type: 'connect', device_index: 0, channel: 1, bitrate: 500000
    })
  })

  it('clearFrames 는 누적된 frames 를 비운다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    act(() => ws._message(rxMsg([rxFrame(), rxFrame()])))
    expect(result.current.frames).toHaveLength(2)

    act(() => result.current.clearFrames())
    expect(result.current.frames).toHaveLength(0)
  })

  it('필터/로깅/DBC 명령을 프로토콜 형식으로 전송한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open()) // readyState = OPEN (sent[0]=list_devices)

    act(() => result.current.setFilter([0x100, 0x7ff]))
    act(() => result.current.startLog('C:\\logs\\can.log'))
    act(() => result.current.stopLog())
    act(() => result.current.replay('C:\\logs\\can.log'))
    act(() => result.current.loadDbc('C:\\dbc\\vehicle.dbc'))

    const sent = ws.sent.slice(1).map((s) => JSON.parse(s)) // 자동 list_devices 제외
    expect(sent).toEqual([
      { type: 'set_filter', ids: [0x100, 0x7ff] },
      { type: 'start_log', path: 'C:\\logs\\can.log' },
      { type: 'stop_log' },
      { type: 'replay', path: 'C:\\logs\\can.log' },
      { type: 'load_dbc', path: 'C:\\dbc\\vehicle.dbc' }
    ])
  })

  it('filter·log_status 이벤트를 filterIds·logStatus 로 디스패치한다', () => {
    const { result } = renderHook(() => useCanSocket('ws://x'))
    const ws = FakeWebSocket.last
    act(() => ws._open())

    // 미통지 초기값은 null(전체통과 [] 와 구분)
    expect(result.current.filterIds).toBeNull()
    expect(result.current.logStatus).toBeNull()

    act(() => ws._message({ type: 'filter', ids: [0x100, 0x200] }))
    expect(result.current.filterIds).toEqual([0x100, 0x200])

    act(() => ws._message({ type: 'filter', ids: [] }))
    expect(result.current.filterIds).toEqual([]) // 전체통과

    act(() => ws._message({ type: 'log_status', logging: true, path: '/tmp/a.log' }))
    expect(result.current.logStatus).toEqual({ logging: true, path: '/tmp/a.log' })
  })
})
