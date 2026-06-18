# 코어 패키징 가이드 (자리표시)

Electron 앱에 Python 코어를 사이드카 바이너리로 동봉하기 위한 PyInstaller 패키징 절차.
(자동화 스크립트는 추후 추가)

## 개요

- PyInstaller는 크로스 컴파일 불가 → Windows/macOS/Linux **각 OS에서 각각** 빌드해야 한다.
- 산출물(단일 실행파일)을 `ui` 빌드 시 `resources/`로 복사하고, Electron main에서 dev/prod 분기로 실행한다.

## 예시 (Windows)

```bash
cd core
pip install pyinstaller
pyinstaller --onefile --name canctl-core -m canctl_core
# dist/canctl-core.exe 생성 → ui 패키징 시 동봉
```

> 주의: pyusb/libusb 백엔드 DLL이 함께 번들되는지 확인할 것.
