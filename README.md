# canalyst-controller

CANalyst-II(ZLG/创芯 USB-CAN 분석기)를 제어하는 **크로스플랫폼 데스크톱 프로그램**입니다.
벤더 종속 `ControlCAN.dll`(Windows 전용) 대신 오픈소스 드라이버를 사용해 Windows/macOS/Linux에서 동작합니다.

## 구조

```
┌──────────────────────┐  WebSocket(JSON)  ┌─────────────────────────┐  pyusb  ┌────────────┐
│ Electron + React UI  │ ◀──ws://127.0.0.1─▶│ Python 코어(사이드카)     │◀──USB──▶│ CANalyst-II │
│ (renderer, WS client)│   :8765            │ asyncio + websockets     │         │ (또는 mock) │
└──────────────────────┘                    │ + CanBackend(추상화)     │         └────────────┘
```

- **core/** — Python 코어. CAN 송수신 + 로컬 WebSocket 서버. 장비 없이 동작하는 `mock` 백엔드와
  실장비용 `canalystii`(python-can) 백엔드를 런타임 선택.
- **ui/** — Electron + React(Vite) 데스크톱 UI. 코어를 사이드카로 띄우고 WebSocket으로 통신.

## 빠른 시작 (개발)

```bash
# 1) Python 코어 (mock 모드, 장비 불필요)
cd core
python -m venv .venv && . .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -e .[dev]
python -m canctl_core --mock          # ws://127.0.0.1:8765 에서 가짜 CAN 트래픽 송출

# 2) UI (별도 터미널)
cd ui
npm install
npm run dev
```

> 자세한 실행법·실장비 연결(특히 **Windows USB 드라이버**) 안내는 문서화 단계(8단계)에서 보강됩니다.

## 라이선스 / 출처

- CAN 통신: [python-can](https://github.com/hardbyte/python-can) + [canalystii](https://github.com/projectgus/python-canalystii) (BSD-3)
