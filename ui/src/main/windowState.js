import { app, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// 창 크기·위치·최대화 상태를 종료 후에도 유지하기 위한 기본값.
export const DEFAULT_WINDOW_STATE = { width: 1280, height: 900 }

// 창 상태 저장 파일 경로. userData 는 app ready 전에도 안전하나,
// 순서 의존을 원천 차단하려 호출 시점에 평가한다.
export function windowStateFile() {
  return join(app.getPath('userData'), 'window-state.json')
}

// 저장된 창 상태를 읽어 기본값과 병합한다. 파일이 없거나 깨졌으면 기본값.
export function loadWindowState() {
  try {
    const state = JSON.parse(readFileSync(windowStateFile(), 'utf-8'))
    return { ...DEFAULT_WINDOW_STATE, ...state }
  } catch {
    return { ...DEFAULT_WINDOW_STATE }
  }
}

// 현재 창 상태를 동기로 기록한다(quit 전 완료 보장). close 시 1회면 충분.
export function saveWindowState(win) {
  if (!win || win.isDestroyed()) return
  try {
    // 최대화/전체화면 중에도 복원용 정상 크기를 저장해야 하므로 normalBounds 사용.
    const bounds = win.getNormalBounds()
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    }
    writeFileSync(windowStateFile(), JSON.stringify(state), 'utf-8')
  } catch (err) {
    console.error('[window-state] 저장 실패:', err)
  }
}

// 저장된 창 좌상단이 현재 연결된 디스플레이 작업영역 안에 들어오는지 검증한다.
// 모니터 구성이 바뀌어 창이 화면 밖으로 사라지는 것을 방지(screen 은 app ready 후 호출).
export function isWithinDisplay(state) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false
  return screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea
    return state.x >= x && state.y >= y && state.x < x + width && state.y < y + height
  })
}
