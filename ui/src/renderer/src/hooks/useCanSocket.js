import { useCallback, useEffect, useRef, useState } from 'react'

// RX 모니터 표시 상한(고부하 시 메모리·렌더 폭주 방지)
const MAX_FRAMES = 500

// 수신 레이트(msg/s) 계산용 슬라이딩 윈도우 길이(ms).
// 도착 벽시계 기준 최근 1초간 카운트를 합산해 초당 메시지수로 환산한다.
const RATE_WINDOW_MS = 1000

// 누적 통계 초기값(frames 의 500개 캡과 무관하게 전체 기간을 누적한다)
const EMPTY_STATS = { total: 0, byId: {}, rate: 0 }

/**
 * 코어 WebSocket 연결을 관리하고 상태/장치/RX 프레임을 노출하며,
 * 명령 전송 함수를 제공하는 훅.
 */
export function useCanSocket(url) {
  const [connState, setConnState] = useState('connecting') // connecting|open|closed|error
  const [status, setStatus] = useState(null)
  const [devices, setDevices] = useState([])
  const [frames, setFrames] = useState([])
  const [error, setError] = useState(null)
  const [filterIds, setFilterIds] = useState(null) // null=미통지, []=전체통과
  const [logStatus, setLogStatus] = useState(null) // null=미통지, {logging,path}
  const [stats, setStats] = useState(EMPTY_STATS) // 누적 수신 통계(frames 와 독립)
  const [dbcMessages, setDbcMessages] = useState([]) // 로드된 DBC 메시지 정의 목록

  const wsRef = useRef(null)
  const seqRef = useRef(0)
  // 레이트용 시간창 버킷: 배치 도착마다 {t: 도착 벽시계ms, n: 카운트} 를 쌓고
  // 윈도우 밖은 잘라낸다. 프레임마다 타임스탬프를 보관하지 않아(고부하 시 폭주 방지)
  // 메모리가 윈도우 내 배치 수에 비례한다.
  const rateBucketsRef = useRef([])

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnState('open')
      ws.send(JSON.stringify({ type: 'list_devices' }))
    }
    ws.onclose = () => setConnState('closed')
    ws.onerror = () => setConnState('error')
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      switch (msg.type) {
        case 'status':
          setStatus(msg)
          break
        case 'devices':
          setDevices(msg.list)
          break
        case 'rx': {
          const tagged = msg.frames.map((f) => ({ ...f, _seq: seqRef.current++ }))
          setFrames((prev) => {
            const next = prev.concat(tagged)
            return next.length > MAX_FRAMES ? next.slice(next.length - MAX_FRAMES) : next
          })

          // 누적 수신 통계 갱신: frames 의 500개 캡과 무관하게 전체 기간을 누적한다.
          // 수신(RX)만 카운트하고 TX 에코(dir==='tx')는 제외해 "수신" 의미를 지킨다.
          const rxFrames = tagged.filter((f) => f.dir !== 'tx')
          if (rxFrames.length > 0) {
            const now = Date.now()
            // 레이트 버킷에 이번 배치 카운트 추가 후 윈도우 밖 제거
            const buckets = rateBucketsRef.current
            buckets.push({ t: now, n: rxFrames.length })
            const cutoff = now - RATE_WINDOW_MS
            while (buckets.length > 0 && buckets[0].t < cutoff) buckets.shift()
            const windowCount = buckets.reduce((sum, b) => sum + b.n, 0)
            const rate = (windowCount * 1000) / RATE_WINDOW_MS

            setStats((prev) => {
              const byId = { ...prev.byId }
              for (const f of rxFrames) {
                const key = f.can_id
                byId[key] = (byId[key] || 0) + 1
              }
              return { total: prev.total + rxFrames.length, byId, rate }
            })
          }
          break
        }
        case 'filter':
          setFilterIds(msg.ids)
          break
        case 'log_status':
          setLogStatus({ logging: msg.logging, path: msg.path })
          break
        case 'dbc_messages':
          setDbcMessages(msg.messages)
          break
        case 'error':
          setError(msg.message)
          break
        default:
          break
      }
    }

    return () => ws.close()
  }, [url])

  const send = useCallback((obj) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }, [])

  const connect = useCallback(
    (deviceIndex, channel, bitrate) =>
      send({ type: 'connect', device_index: deviceIndex, channel, bitrate }),
    [send]
  )
  const disconnect = useCallback(() => send({ type: 'disconnect' }), [send])
  const sendFrame = useCallback((frame) => send({ type: 'send', ...frame }), [send])
  const refreshDevices = useCallback(() => send({ type: 'list_devices' }), [send])
  const clearFrames = useCallback(() => setFrames([]), [])
  const clearError = useCallback(() => setError(null), [])
  // 누적 통계 초기화: 카운트·레이트 버킷을 모두 비운다(frames 지우기와 독립).
  const resetStats = useCallback(() => {
    rateBucketsRef.current = []
    setStats(EMPTY_STATS)
  }, [])

  // 필터/로깅/DBC 명령(core 가 결과를 filter·log_status 이벤트나 error 로 통지)
  const setFilter = useCallback((ids) => send({ type: 'set_filter', ids }), [send])
  const startLog = useCallback((path) => send({ type: 'start_log', path }), [send])
  const stopLog = useCallback(() => send({ type: 'stop_log' }), [send])
  const replay = useCallback((path) => send({ type: 'replay', path }), [send])
  const loadDbc = useCallback((path) => send({ type: 'load_dbc', path }), [send])
  // DBC 송신: 메시지 정의 목록 요청 / 신호값 인코딩 후 송신.
  // (코어가 dbc_messages 이벤트나 error 로 통지하고, 송신 프레임은 rx 에코로 돌아온다)
  const listDbcMessages = useCallback(() => send({ type: 'list_dbc_messages' }), [send])
  const encodeSend = useCallback(
    (message, signals, channel) => send({ type: 'encode_send', message, signals, channel }),
    [send]
  )

  return {
    connState,
    status,
    devices,
    frames,
    error,
    filterIds,
    logStatus,
    stats,
    dbcMessages,
    connect,
    disconnect,
    sendFrame,
    refreshDevices,
    clearFrames,
    clearError,
    resetStats,
    setFilter,
    startLog,
    stopLog,
    replay,
    loadDbc,
    listDbcMessages,
    encodeSend
  }
}
