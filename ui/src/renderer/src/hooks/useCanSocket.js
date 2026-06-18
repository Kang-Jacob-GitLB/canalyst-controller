import { useCallback, useEffect, useRef, useState } from 'react'

// RX 모니터 표시 상한(고부하 시 메모리·렌더 폭주 방지)
const MAX_FRAMES = 500

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

  const wsRef = useRef(null)
  const seqRef = useRef(0)

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
          break
        }
        case 'filter':
          setFilterIds(msg.ids)
          break
        case 'log_status':
          setLogStatus({ logging: msg.logging, path: msg.path })
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

  // 필터/로깅/DBC 명령(core 가 결과를 filter·log_status 이벤트나 error 로 통지)
  const setFilter = useCallback((ids) => send({ type: 'set_filter', ids }), [send])
  const startLog = useCallback((path) => send({ type: 'start_log', path }), [send])
  const stopLog = useCallback(() => send({ type: 'stop_log' }), [send])
  const replay = useCallback((path) => send({ type: 'replay', path }), [send])
  const loadDbc = useCallback((path) => send({ type: 'load_dbc', path }), [send])

  return {
    connState,
    status,
    devices,
    frames,
    error,
    filterIds,
    logStatus,
    connect,
    disconnect,
    sendFrame,
    refreshDevices,
    clearFrames,
    clearError,
    setFilter,
    startLog,
    stopLog,
    replay,
    loadDbc
  }
}
