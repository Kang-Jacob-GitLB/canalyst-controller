# 코어 패키징 가이드 (PyInstaller)

Electron 앱에 Python 코어를 사이드카 단일 실행파일로 동봉하기 위한 빌드 절차.

- PyInstaller 는 크로스 컴파일 불가 → Windows/macOS/Linux **각 OS에서 각각** 빌드한다.
- 엔트리포인트는 `core/pyinstaller_entry.py` (PyInstaller 는 `python -m` 모듈 실행을 지원하지 않으므로 둔다).

## 빌드

```bash
cd core
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install pyinstaller
pyinstaller --onefile --name canctl-core --noconfirm \
  --collect-all canalystii --collect-all libusb_package --collect-all cantools \
  --collect-submodules can --collect-submodules canctl_core \
  --distpath dist --workpath build --specpath . \
  pyinstaller_entry.py
```

→ `core/dist/canctl-core`(.exe) 생성. `--collect-all` 로 USB 백엔드(libusb_package),
canalystii, cantools(DBC) 데이터·DLL 을 함께 번들한다.

검증(mock):

```bash
dist/canctl-core --mock --port 8801   # 다른 터미널에서 ws://127.0.0.1:8801 접속 확인
```

## Electron 앱에 동봉

`ui/electron-builder.yml` 의 `extraResources` 가 `core/dist` 를 앱의 `resources/core/` 로 복사한다.
패키징된 앱에서 `ui/src/main/index.js` 는 `process.resourcesPath/core/canctl-core(.exe)` 를 사이드카로 실행한다.

```bash
cd ui
npm run dist        # electron-vite build && electron-builder
```
