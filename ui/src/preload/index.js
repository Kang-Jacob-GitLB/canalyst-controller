import { contextBridge, ipcRenderer } from 'electron'
import { sep } from 'path'

const CORE_PORT = 8765

// 렌더러에 코어 WebSocket 접속 정보 + 파일 다이얼로그 노출
contextBridge.exposeInMainWorld('canctl', {
  coreUrl: `ws://127.0.0.1:${CORE_PORT}`,
  corePort: CORE_PORT,
  pickOpenFile: (options) => ipcRenderer.invoke('pick-open-file', options),
  pickSaveFile: (options) => ipcRenderer.invoke('pick-save-file', options),
  // 폴더 선택 다이얼로그(로그 저장 폴더 지정용). 취소 시 null.
  pickDirectory: (options) => ipcRenderer.invoke('pick-directory', options),
  // OS 경로 구분자 — 렌더러에서 폴더+자동 파일명 조합에 사용(win '\\', posix '/')
  pathSep: sep,
  // CANalyst-II WinUSB 드라이버 상태 조회(장치 미검출 원인 안내용)
  checkDriver: () => ipcRenderer.invoke('check-driver'),
  // 외부 링크 열기(Zadig 안내 등). main 에서 https 만 허용.
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
})
