// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// electron 의 app.getPath / screen 만 모킹하고, fs 는 임시 디렉토리에 실제 IO 를 수행한다.
const mocks = vi.hoisted(() => ({ userData: '', displays: [] }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  screen: { getAllDisplays: () => mocks.displays }
}))

import {
  loadWindowState,
  saveWindowState,
  isWithinDisplay,
  windowStateFile,
  DEFAULT_WINDOW_STATE
} from './windowState'

// 실제 BrowserWindow 대신 동일한 인터페이스를 가진 가짜 창.
function fakeWin({ bounds, maximized = false, fullScreen = false, destroyed = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    getNormalBounds: () => bounds,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen
  }
}

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const SECONDARY = { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wstate-'))
  mocks.userData = dir
  mocks.displays = [PRIMARY]
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('save → load 라운드트립', () => {
  it('저장한 크기·위치·상태를 그대로 복원한다', () => {
    const win = fakeWin({ bounds: { x: 300, y: 200, width: 1111, height: 777 } })
    saveWindowState(win)
    expect(existsSync(windowStateFile())).toBe(true)

    const state = loadWindowState()
    expect(state).toMatchObject({
      x: 300,
      y: 200,
      width: 1111,
      height: 777,
      isMaximized: false,
      isFullScreen: false
    })
  })

  it('최대화 상태에서도 normalBounds(복원 크기)를 저장한다', () => {
    // 최대화 중 getBounds 는 전체 화면 크기지만, getNormalBounds 는 복원 크기를 준다.
    const win = fakeWin({
      bounds: { x: 50, y: 60, width: 1280, height: 900 },
      maximized: true
    })
    saveWindowState(win)

    const state = loadWindowState()
    expect(state.width).toBe(1280)
    expect(state.height).toBe(900)
    expect(state.isMaximized).toBe(true)
  })

  it('전체화면 플래그를 보존한다', () => {
    const win = fakeWin({ bounds: { x: 0, y: 0, width: 1280, height: 900 }, fullScreen: true })
    saveWindowState(win)
    expect(loadWindowState().isFullScreen).toBe(true)
  })
})

describe('loadWindowState 기본값 처리', () => {
  it('저장 파일이 없으면 기본값을 반환한다', () => {
    expect(loadWindowState()).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('파일이 깨졌어도 기본값으로 폴백한다', () => {
    writeFileSync(windowStateFile(), '{ not json', 'utf-8')
    expect(loadWindowState()).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('누락 필드는 기본값과 병합한다', () => {
    writeFileSync(windowStateFile(), JSON.stringify({ x: 10, y: 20 }), 'utf-8')
    const state = loadWindowState()
    expect(state.x).toBe(10)
    expect(state.width).toBe(DEFAULT_WINDOW_STATE.width)
    expect(state.height).toBe(DEFAULT_WINDOW_STATE.height)
  })
})

describe('saveWindowState 방어 처리', () => {
  it('win 이 null 이면 파일을 만들지 않는다', () => {
    saveWindowState(null)
    expect(existsSync(windowStateFile())).toBe(false)
  })

  it('파괴된 창이면 저장하지 않는다', () => {
    const win = fakeWin({ bounds: { x: 0, y: 0, width: 800, height: 600 }, destroyed: true })
    saveWindowState(win)
    expect(existsSync(windowStateFile())).toBe(false)
  })
})

describe('isWithinDisplay 가시성 검증', () => {
  it('주 디스플레이 영역 안이면 true', () => {
    expect(isWithinDisplay({ x: 100, y: 100 })).toBe(true)
  })

  it('모든 디스플레이 밖이면 false', () => {
    expect(isWithinDisplay({ x: -3000, y: -3000 })).toBe(false)
    expect(isWithinDisplay({ x: 5000, y: 100 })).toBe(false)
  })

  it('보조 디스플레이 영역 안이면 true', () => {
    mocks.displays = [PRIMARY, SECONDARY]
    expect(isWithinDisplay({ x: 2000, y: 100 })).toBe(true)
  })

  it('이전에 보조 디스플레이에 있었으나 지금은 단일 모니터면 false', () => {
    // 모니터를 분리한 상황: 저장된 좌표가 더 이상 어느 화면에도 속하지 않음.
    mocks.displays = [PRIMARY]
    expect(isWithinDisplay({ x: 2500, y: 100 })).toBe(false)
  })

  it('좌표가 없으면(첫 실행 등) false', () => {
    expect(isWithinDisplay({ width: 1280, height: 900 })).toBe(false)
  })
})
