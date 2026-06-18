# canalyst-controller

CANalyst-II(ZLG/创芯 USB-CAN 분석기)를 제어하는 **크로스플랫폼 데스크톱 프로그램**입니다.
벤더 종속 `ControlCAN.dll`(Windows 전용) 대신 오픈소스 드라이버를 사용해 Windows/macOS/Linux에서 동작합니다.

- **코어**: Python — CAN 송수신 + 로컬 WebSocket 서버 (`python-can` + `canalystii`)
- **UI**: Electron + React(Vite) — 코어를 사이드카로 띄우고 WebSocket으로 통신

## 아키텍처

```
┌──────────────────────┐  WebSocket(JSON)  ┌─────────────────────────┐  pyusb  ┌────────────┐
│ Electron + React UI  │ ◀──ws://127.0.0.1─▶│ Python 코어(사이드카)     │◀──USB──▶│ CANalyst-II │
│ (renderer, WS client)│   :8765            │ asyncio + websockets     │         │ (또는 mock) │
└──────────────────────┘                    │ + CanBackend(추상화)     │         └────────────┘
   Electron main process 가 앱 시작 시 코어를 spawn, 종료 시 함께 종료
```

CAN은 폴링 방식이라, 코어가 백그라운드에서 폴링·배칭한 프레임을 WebSocket으로 push 합니다.

## 요구사항

- Python 3.10 이상
- Node.js 18 이상 (electron-vite, Electron 42 / vite 7)
- (실장비) CANalyst-II + Windows에서는 WinUSB 드라이버

## 설치 & 실행 (개발, mock 모드 — 장비 불필요)

```bash
# 1) Python 코어
cd core
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -e .[dev]

# 2) UI (별도 터미널) — 코어는 UI가 자동으로 사이드카로 띄웁니다
cd ui
npm install
npm run dev
```

`npm run dev` 한 번으로 Electron 창이 뜨고, 코어(mock 백엔드)가 자동 기동되어 가짜 CAN 트래픽이
수신 모니터에 흐릅니다. 연결 → 송신(TX) → 수신(RX) 흐름을 장비 없이 확인할 수 있습니다.

코어만 단독 실행하려면:

```bash
cd core
python -m canctl_core --mock          # ws://127.0.0.1:8765
python -m canctl_core --mock --port 8800 --log-level DEBUG
```

테스트:

```bash
cd core && python -m pytest
```

## 실장비 연결

### 1) Windows USB 드라이버 (중요)

오픈소스 경로(pyusb)는 장치에 직접 접근하기 위해 **WinUSB 드라이버**가 필요합니다.

1. [Zadig](https://zadig.akeo.ie/) 실행
2. Options → List All Devices 체크
3. 목록에서 CANalyst-II(USBCAN) 장치 선택
4. 드라이버를 **WinUSB** 로 교체(Replace/Install)

> ⚠️ WinUSB로 교체하면 **벤더 공식 소프트웨어(ZCANPRO/CANTest)는 드라이버를 되돌리기 전까지 동작하지 않습니다.**
> macOS/Linux는 libusb로 접근하며, Linux는 udev 규칙으로 비루트 접근을 허용해야 할 수 있습니다.

### 2) 동작 확인 (스모크 테스트)

UI를 거치지 않고 드라이버가 장치를 실제로 읽는지 먼저 확인합니다:

```bash
core\.venv\Scripts\python scripts\smoke_device.py --channel 0 --bitrate 500000
```

`TOTAL_FRAMES` 가 0보다 크면(또는 버스에 트래픽이 없다면 최소한 연결·종료가 에러 없이) 정상입니다.

### 3) UI에서 실장비 사용

기본은 mock 모드입니다. 실장비로 띄우려면 `CANCTL_REAL` 환경변수를 설정하세요(소스 편집 불필요):

```bash
# Windows (PowerShell)
$env:CANCTL_REAL=1; npm run dev
# macOS/Linux
CANCTL_REAL=1 npm run dev
```

(향후 UI 내 토글 버튼으로 전환 예정)

## WebSocket 프로토콜 (JSON, 한 줄 = 한 메시지)

| 방향 | 메시지 | 설명 |
|------|--------|------|
| C→S | `{type:"list_devices"}` | 장치 목록 요청 |
| C→S | `{type:"connect", device_index, channel, bitrate}` | 연결 |
| C→S | `{type:"disconnect"}` | 해제 |
| C→S | `{type:"send", channel, can_id, extended, rtr, data:[..]}` | 프레임 송신 |
| S→C | `{type:"devices", list:[{index,name,channels}]}` | 장치 목록 |
| S→C | `{type:"status", connected, backend, device, channels}` | 상태 |
| S→C | `{type:"rx", frames:[{ts,channel,can_id,extended,rtr,dlc,data}]}` | 수신(배칭) |
| S→C | `{type:"error", message}` | 오류 |

- `bitrate` 는 정수(10000~1000000 표준값 권장). UI는 드롭다운으로 입력합니다.

## 한계

- canalystii 드라이버는 **송신 ACK·버스에러·수신 버퍼 오버플로 보고를 지원하지 않습니다.** TX는 "전송 큐잉" 수준입니다.
- 고부하(1Mbps ~7800 msg/s) 시 UI는 표시 프레임을 최근 500개로 제한합니다.
- CAN FD 미지원(표준 CAN만).

## 트러블슈팅

- **`Error: Electron uninstall`**: Electron 바이너리 미설치 → `node ui/node_modules/electron/install.js` 실행.
- **`npm ERESOLVE` (vite/plugin-react)**: `electron-vite@5` 는 vite 7까지 지원 → `vite@7` + `@vitejs/plugin-react@5` 로 맞춥니다.
- **`No backend available` (usb.core.NoBackendError)**: pyusb 의 libusb-1.0 백엔드 부재. `libusb-package` 가 의존성에 포함되어 `pip install -e .` 시 자동 설치되고, 코어가 번들 백엔드를 자동 주입하므로 별도 DLL 설치가 필요 없습니다.
- **실장비 연결 실패/접근 거부**: 다른 프로그램(ZCANPRO 등)이 장치를 점유 중인지 확인. 접근이 거부되면 Zadig 로 WinUSB 드라이버를 설정하세요.
- **연결은 되는데 수신 프레임 0개**: 비트레이트가 실제 버스와 일치하는지, 버스에 트래픽이 흐르는지 확인하세요.

## 라이선스 / 출처

- CAN 통신: [python-can](https://github.com/hardbyte/python-can) + [canalystii](https://github.com/projectgus/python-canalystii) (BSD-3, 리버스 엔지니어링 드라이버)
