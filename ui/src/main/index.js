import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'

const CORE_PORT = 8765
let coreProc = null
let mainWindow = null

/**
 * Python 코어를 사이드카로 기동한다.
 * 개발 모드: core/.venv 의 python 으로 mock 백엔드 실행.
 * 패키징 모드: PyInstaller 바이너리 실행(추후 구현).
 */
function startCore() {
  if (app.isPackaged) {
    console.warn('[core] 패키징된 코어 실행은 추후 구현됩니다')
    return
  }
  const python =
    process.platform === 'win32'
      ? join(__dirname, '../../../core/.venv/Scripts/python.exe')
      : join(__dirname, '../../../core/.venv/bin/python')
  const cwd = join(__dirname, '../../../core')

  coreProc = spawn(
    python,
    ['-m', 'canctl_core', '--mock', '--port', String(CORE_PORT)],
    { cwd, stdio: 'inherit' }
  )
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
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
