import { contextBridge, ipcRenderer } from 'electron'

const CORE_PORT = 8765

// 렌더러에 코어 WebSocket 접속 정보 + 파일 다이얼로그 노출
contextBridge.exposeInMainWorld('canctl', {
  coreUrl: `ws://127.0.0.1:${CORE_PORT}`,
  corePort: CORE_PORT,
  pickOpenFile: (options) => ipcRenderer.invoke('pick-open-file', options),
  pickSaveFile: (options) => ipcRenderer.invoke('pick-save-file', options)
})
