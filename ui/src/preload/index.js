import { contextBridge } from 'electron'

const CORE_PORT = 8765

// 렌더러에 코어 WebSocket 접속 정보 노출
contextBridge.exposeInMainWorld('canctl', {
  coreUrl: `ws://127.0.0.1:${CORE_PORT}`,
  corePort: CORE_PORT
})
