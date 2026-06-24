# 코어 패키징 가이드 (PyInstaller)

Electron 앱에 Python 코어를 사이드카 단일 실행파일로 동봉하기 위한 빌드 절차.

- PyInstaller 는 크로스 컴파일 불가 → Windows/macOS/Linux **각 OS에서 각각** 빌드한다.
- 엔트리포인트는 `core/pyinstaller_entry.py` (PyInstaller 는 `python -m` 모듈 실행을 지원하지 않으므로 둔다).
- 실행파일 이름은 **`canalyst-core`**(멀티콜). import 패키지명은 `canctl_core` 유지.

## 빌드

```bash
cd core
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install pyinstaller
pyinstaller --onefile --name canalyst-core --noconfirm \
  --collect-all canalystii --collect-all libusb_package --collect-all cantools \
  --collect-submodules can --collect-submodules canctl_core \
  --distpath dist --workpath build --specpath . \
  pyinstaller_entry.py
```

→ `core/dist/canalyst-core`(.exe) 생성. `--collect-all` 로 USB 백엔드(libusb_package),
canalystii, cantools(DBC) 데이터·DLL 을 함께 번들한다.

**멀티콜 바이너리**: `--collect-submodules canctl_core` 로 `cli.py`/`mcp_server.py` 까지 함께
번들되며, 엔트리포인트(`pyinstaller_entry.py` → `canctl_core.multicall`)가 첫 인자로 분기한다
— 하나의 바이너리가 서버·CLI·MCP 를 겸한다(추가 빌드/용량 없음):

```bash
dist/canalyst-core --mock --port 8801                       # WebSocket 서버(사이드카 경로)
dist/canalyst-core cli --url ws://127.0.0.1:8801 status     # AI/스크립트용 CLI
dist/canalyst-core mcp --url ws://127.0.0.1:8801            # 로컬 MCP 서버(stdio)
```

설치본에서는 `process.resourcesPath/core/canalyst-core(.exe) cli|mcp <...>` 로 호출하면
AI/스크립트가 배포된 제품을 그대로 제어할 수 있다(서버가 떠 있어야 함).

### MCP 모드 동결(선택, ⚠️ 미검증)

`mcp` 는 옵션 의존성(`[mcp]` extra)이라 기본 빌드에는 포함되지 않는다. 동결 바이너리에서도
`canalyst-core mcp` 를 쓰려면 빌드 환경에 mcp 를 설치하고 PyInstaller 가 mcp/pydantic 을
수집하게 한다:

```bash
pip install -e .[mcp]
pyinstaller ... --collect-all mcp pyinstaller_entry.py    # 위 빌드 명령에 --collect-all mcp 추가
```

> mcp 는 pydantic/pydantic_core/anyio 등을 끌어와 PyInstaller 번들이 까다롭다.
> **현재 동결 빌드에서의 mcp 모드는 미검증**이다(개발 설치 `python -m canctl_core.mcp_server`
> 및 `pip install -e .[mcp]` 의 `canalyst-core mcp` 는 검증됨). 실제 릴리스 전 동결
> 바이너리에서 `mcp` 모드 기동을 확인할 것.

검증(mock):

```bash
dist/canalyst-core --mock --port 8801   # 다른 터미널에서 ws://127.0.0.1:8801 접속 확인
dist/canalyst-core cli --url ws://127.0.0.1:8801 devices   # CLI 분기 동작 확인
```

## Electron 앱에 동봉

`ui/electron-builder.yml` 의 `extraResources` 가 `core/dist` 를 앱의 `resources/core/` 로 복사한다.
패키징된 앱에서 `ui/src/main/index.js` 는 `process.resourcesPath/core/canalyst-core(.exe)` 를 사이드카로 실행한다.

```bash
cd ui
npm run dist        # electron-vite build && electron-builder
```
