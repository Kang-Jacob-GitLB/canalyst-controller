import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { spawn, execFileSync } from 'child_process'
import { loadWindowState, saveWindowState, isWithinDisplay } from './windowState'
import { checkCanalystDriver } from './driverCheck'
import { probeDaemon } from './coreDaemon'

const CORE_PORT = 8765
//: 종료 시 코어가 stdin EOF 를 받고 스스로 graceful 종료(장비 해제)할 때까지 기다리는 시간(ms).
//  이 안에 안 죽으면 프로세스 트리를 강제 종료한다.
const CORE_SHUTDOWN_TIMEOUT_MS = 2000
//: attach 모드(외부 데몬 사용)에서 그 데몬 생존을 확인하는 폴링 간격(ms).
const CORE_MONITOR_INTERVAL_MS = 3000
let coreProc = null
let coreExited = false  // 코어가 이미 종료됐는지(중복 kill 방지)
let quitting = false    // before-quit graceful 시퀀스 재진입 방지
let mainWindow = null
//: 우리가 띄운 데몬인가? false 면 외부(플러그인/수동) 데몬에 attach 한 상태 →
//  종료 시 그 데몬을 죽이지 않고, 사라지면 take-over 로 우리가 띄운다.
let ownDaemon = false

/**
 * Python 코어를 사이드카로 기동한다.
 * 개발 모드: core/.venv 의 python 으로 `-m canctl_core` 실행.
 * 패키징 모드: extraResources 로 동봉된 PyInstaller 단일 바이너리(resources/core/) 실행.
 * 기본은 실장비(canalystii). CANCTL_MOCK 환경변수가 설정되면 데모(mock) 모드.
 */
function spawnCore() {
  // 기본은 실장비(canalystii) 모드. 장비 없이 데모를 보려면 CANCTL_MOCK 설정.
  const useMock = !!process.env.CANCTL_MOCK
  const coreArgs = ['--port', String(CORE_PORT)]
  if (useMock) coreArgs.push('--mock')
  console.log(`[core] 기동 모드: ${useMock ? 'mock(데모)' : '실장비(canalystii)'}`)

  let command
  let args
  let cwd
  if (app.isPackaged) {
    // 패키징: resources/core/ 에 동봉된 PyInstaller 바이너리
    const exe = process.platform === 'win32' ? 'canalyst-core.exe' : 'canalyst-core'
    cwd = join(process.resourcesPath, 'core')
    command = join(cwd, exe)
    args = coreArgs
  } else {
    // 개발: venv python 으로 -m canctl_core 실행
    command =
      process.platform === 'win32'
        ? join(__dirname, '../../../core/.venv/Scripts/python.exe')
        : join(__dirname, '../../../core/.venv/bin/python')
    cwd = join(__dirname, '../../../core')
    args = ['-m', 'canctl_core', ...coreArgs]
  }

  coreExited = false
  coreProc = spawn(command, args, {
    cwd,
    // 콘솔 앱인 코어를 spawn 할 때 별도 콘솔 창이 뜨지 않게 한다.
    windowsHide: true,
    // stdin 은 항상 pipe 로 연다: 종료 시 stdin.end() 로 EOF 를 주면 코어가
    // 스스로 graceful 종료(장비 해제)한다. Electron 이 크래시해도 파이프가
    // 닫히며 EOF 가 전달되어 코어가 orphan 으로 남지 않는다.
    // stdout/stderr 는 패키징 시 버리고(창 방지), 개발 시 터미널 로그 유지.
    stdio: app.isPackaged ? ['pipe', 'ignore', 'ignore'] : ['pipe', 'inherit', 'inherit'],
    // 코어 한글 로그가 콘솔에서 깨지지 않도록 UTF-8 강제
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  })
  coreProc.on('error', (err) => console.error('[core] spawn 실패:', err))
  coreProc.on('exit', (code) => {
    console.log('[core] 종료 코드:', code)
    coreExited = true
    coreProc = null
  })
  ownDaemon = true
}

/**
 * 데몬을 확보한다 — 이미 8765 에 데몬(플러그인/수동 실행)이 있으면 사이드카를 새로
 * 띄우지 않고 그 데몬에 attach(같은 장치 공유, 포트 충돌 방지). 없으면 우리가 띄워 소유.
 * 어느 순서로 켜든(플러그인 먼저든 앱 먼저든) 충돌 없이 단일 데몬을 공유하게 한다.
 */
async function ensureCore() {
  if (coreProc && !coreExited) return  // 우리가 띄운 데몬이 살아있음
  if (await probeDaemon(CORE_PORT)) {
    // attach 모드: coreProc 를 절대 설정하지 않는다. 종료 정리(before-quit/forceKillCoreTree)는
    // coreProc 핸들로만 동작하므로, coreProc=null 이어야 외부(플러그인/수동) 데몬을 죽이지 않는다.
    // 불변식: coreProc != null  ⟺  우리가 spawn 한 데몬(spawnCore 만 coreProc 를 설정). 깨지 말 것.
    console.log('[core] 기존 데몬 발견(8765) → 사이드카 미기동, attach')
    ownDaemon = false
    return
  }
  spawnCore()
}

/**
 * attach 모드 한정 take-over 감시: 붙어쓰던 외부 데몬이 사라지면(플러그인/세션 종료 등)
 * 우리가 넘겨받아 사이드카를 띄운다. 우리가 소유한 데몬은 건드리지 않는다(기존 종료/
 * 크래시 동작 유지). 렌더러는 자동 재연결하므로 새 데몬에 다시 붙는다.
 */
function startDaemonMonitor() {
  setInterval(async () => {
    if (quitting || ownDaemon) return
    if (!(await probeDaemon(CORE_PORT))) {
      console.log('[core] attach 중이던 데몬이 사라짐 → take-over')
      await ensureCore()
    }
  }, CORE_MONITOR_INTERVAL_MS)
}

/**
 * 코어 프로세스 트리를 강제 종료한다(best-effort, 동기).
 * Windows: taskkill /T 로 자식까지(특히 PyInstaller onefile 의 bootloader→child).
 *          coreProc.kill() 은 부모만 죽여 child 가 orphan 으로 남으므로 쓰지 않는다.
 * 그 외 플랫폼: SIGKILL.
 */
function forceKillCoreTree() {
  const proc = coreProc
  if (!proc || coreExited) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      // 이미 죽었거나 권한 문제 — 마지막 수단으로 직접 kill 시도
      try { proc.kill('SIGKILL') } catch { /* noop */ }
    }
  } else {
    try { proc.kill('SIGKILL') } catch { /* noop */ }
  }
}

// 파일 선택 다이얼로그(렌더러 → main IPC). 취소 시 null 반환.
ipcMain.handle('pick-open-file', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('pick-save-file', async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: options.filters,
    defaultPath: options.defaultPath
  })
  return result.canceled ? null : result.filePath
})

// 폴더 선택 다이얼로그(로그 저장 폴더 지정용). 없는 폴더는 만들 수 있게 허용. 취소 시 null.
ipcMain.handle('pick-directory', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: options.defaultPath
  })
  return result.canceled ? null : result.filePaths[0]
})

// CANalyst-II WinUSB 드라이버 상태 조회. 장치가 안 보일 때 렌더러가 "장치 없음"의
// 원인(미연결 / 드라이버가 WinUSB 아님)을 사용자에게 안내하는 데 쓴다.
ipcMain.handle('check-driver', () => checkCanalystDriver())

// 외부 링크 열기(Zadig 안내 등). https 만 허용해 임의 스킴 실행을 막는다.
ipcMain.handle('open-external', (_event, url) =>
  typeof url === 'string' && /^https:\/\//i.test(url) ? shell.openExternal(url) : false
)

function createWindow() {
  // 이전 세션의 창 상태를 복원. 위치는 현재 디스플레이 안일 때만 적용한다.
  const state = loadWindowState()
  const useStoredPosition = isWithinDisplay(state)

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(useStoredPosition ? { x: state.x, y: state.y } : {}),
    minWidth: 1000,
    minHeight: 600,
    title: 'CANalyst-II Controller',
    backgroundColor: '#121212',
    // 개발 모드 창 아이콘. __dirname 은 out/main 이므로 ui/build/icon.png 로 해석된다.
    // (패키징 창/실행 파일 아이콘은 electron-builder 가 build/icon.png 에서 별도 생성한다.)
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 이전 세션이 최대화/전체화면이었으면 그대로 복원.
  if (state.isMaximized) mainWindow.maximize()
  if (state.isFullScreen) mainWindow.setFullScreen(true)

  // 창이 닫히기 직전 현재 크기·위치·상태를 저장(종료 후 재실행 시 복원).
  mainWindow.on('close', () => saveWindowState(mainWindow))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await ensureCore()       // 기존 데몬 있으면 attach, 없으면 spawn
  startDaemonMonitor()     // attach 모드면 데몬 소실 시 take-over
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 앱 종료 시퀀스(여기 한 곳으로 모은다):
// 1) stdin 을 닫아 코어가 stdin EOF 로 graceful 종료(장비 disconnect)하게 유도
// 2) 타임아웃 안에 안 죽으면 프로세스 트리를 강제 종료
// 3) 코어가 종료되면 app.quit() 재호출로 실제 종료 진행
app.on('before-quit', (event) => {
  if (quitting || coreExited || !coreProc) return  // 이미 처리 중/종료됨 → 통과
  quitting = true
  event.preventDefault()  // 코어 정리가 끝날 때까지 종료 보류

  const proc = coreProc
  let timer = null
  const finish = () => {
    if (timer) clearTimeout(timer)
    proc.removeListener('exit', finish)
    app.quit()  // quitting 가드로 이 핸들러는 다시 타지 않는다
  }
  proc.once('exit', finish)

  // graceful: stdin 을 닫아 EOF 전달 → 코어가 스스로 disconnect 후 종료
  try { proc.stdin && proc.stdin.end() } catch { /* noop */ }

  // 타임아웃 안에 graceful 종료가 안 되면 트리 강제 종료
  timer = setTimeout(() => {
    timer = null
    forceKillCoreTree()
    finish()
  }, CORE_SHUTDOWN_TIMEOUT_MS)
})

// 최후 안전망: 위 시퀀스를 거치지 않은 경로로 종료되더라도 동기 강제 종료.
app.on('quit', forceKillCoreTree)
