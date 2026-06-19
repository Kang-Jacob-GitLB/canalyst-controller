import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'

const CORE_PORT = 8765
let coreProc = null
let mainWindow = null

/**
 * Python 코어를 사이드카로 기동한다.
 * 개발 모드: core/.venv 의 python 으로 `-m canctl_core` 실행.
 * 패키징 모드: extraResources 로 동봉된 PyInstaller 단일 바이너리(resources/core/) 실행.
 * 기본은 실장비(canalystii). CANCTL_MOCK 환경변수가 설정되면 데모(mock) 모드.
 */
function startCore() {
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
    const exe = process.platform === 'win32' ? 'canctl-core.exe' : 'canctl-core'
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

  coreProc = spawn(command, args, {
    cwd,
    // 콘솔 앱인 코어를 spawn 할 때 별도 콘솔 창이 뜨지 않게 한다.
    windowsHide: true,
    // 패키징 모드는 콘솔 출력을 버려 창을 띄우지 않고, 개발 모드는 터미널 로그를 유지.
    stdio: app.isPackaged ? 'ignore' : 'inherit',
    // 코어 한글 로그가 콘솔에서 깨지지 않도록 UTF-8 강제
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  })
  coreProc.on('error', (err) => console.error('[core] spawn 실패:', err))
  coreProc.on('exit', (code) => {
    console.log('[core] 종료 코드:', code)
    coreProc = null
  })
}

function stopCore() {
  if (coreProc) {
    coreProc.kill()
    coreProc = null
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    title: 'CANalyst-II Controller',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  startCore()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopCore()
  if (process.platform !== 'darwin') app.quit()
})

// 앱 종료 시 사이드카가 orphan 으로 남지 않도록 확실히 종료
app.on('quit', stopCore)
app.on('before-quit', stopCore)
