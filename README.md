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

## 설치 & 실행 (개발)

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

`npm run dev` 한 번으로 Electron 창이 뜨고 코어가 자동 기동됩니다. **기본은 실장비(canalystii) 모드**라
연결하면 실제 장치에 붙습니다. 장비 없이 UI를 데모로 보려면 mock 모드로 실행하세요:

```powershell
# Windows (PowerShell)
$env:CANCTL_MOCK="1"; npm run dev
# macOS/Linux: CANCTL_MOCK=1 npm run dev
```

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

### 3) 모드 전환 (실장비 ↔ 데모)

**기본은 실장비(canalystii) 모드**입니다 — 그냥 실행하면 실제 장치에 연결합니다.
장비 없이 데모를 보려면 `CANCTL_MOCK` 환경변수를 설정하세요(소스 편집 불필요):

```bash
# Windows (PowerShell)
$env:CANCTL_MOCK=1; npm run dev
# macOS/Linux
CANCTL_MOCK=1 npm run dev
```

## `canalyst-core` — 멀티콜 명령(server / cli / mcp)

배포 실행파일이자 콘솔 명령은 **`canalyst-core`** 하나이며, 첫 인자로 역할이 갈립니다
(파이썬 import 패키지명은 호환을 위해 `canctl_core` 유지):

```bash
canalyst-core [--mock --port ...]   # WebSocket 서버(Electron 사이드카 기본 경로)
canalyst-core cli <명령> ...         # AI/스크립트용 CLI
canalyst-core mcp                    # 로컬 MCP 서버(stdio)
```

개발 환경에서는 `pip install -e .` 로 `canalyst-core` 콘솔 스크립트가 생기며,
설치본에서는 동봉 바이너리(`<앱 resources>/core/canalyst-core(.exe)`)가 같은 규약을
씁니다(서버/CLI/MCP 추가 동봉물 없이 단일 바이너리).

### CLI — AI/스크립트용

UI(Electron)와 동일한 WebSocket 프로토콜을 쓰는 얇은 클라이언트입니다. 실행 중인 코어
데몬에 명령을 한 번씩 보내고 결과를 **JSON 으로 stdout** 에 출력한 뒤 종료합니다(UI 와
동시 사용 가능). 설계상 **어떤 명령도 무한 대기하지 않습니다**: `monitor` 는 항상 유한
(`--duration`/`--count`), 데몬 미기동 시 즉시 실패하며 해결책을 안내하고, 모든 대기는
(응답 | 서버 error | timeout) 중 하나로 끝납니다. 출력은 cp949 콘솔에서도 안전하도록
`ensure_ascii` JSON 입니다. 종료 코드: `0`=성공, `1`=서버 오류, `3`=데몬 연결 불가,
`4`=응답 시간초과.

```bash
# 0) 데몬 기동(백그라운드 유지). 실장비는 --mock 없이.
canalyst-core --mock                 # = python -m canctl_core --mock

# 1) 장치 → 연결 → 송신 → 수신 모니터
canalyst-core cli devices
canalyst-core cli connect 0 --bitrate 500000
canalyst-core cli send 0x123 --data 0x01 0x02 0x03
canalyst-core cli monitor --duration 2 --count 50 --ids 0x100 0x200

# 2) 주기 송신 / 중지
canalyst-core cli send-periodic 0x321 --data 0xAA 0xBB --period 0.1 --count 10
canalyst-core cli stop-periodic            # id 생략 시 전체 중지

# 3) 로깅 / 재생 / 내보내기
canalyst-core cli log-start run.jsonl
canalyst-core cli log-stop
canalyst-core cli replay run.jsonl --duration 5
canalyst-core cli export run.jsonl out.asc --format asc

# 4) DBC
canalyst-core cli dbc-load vehicle.dbc
canalyst-core cli dbc-messages
canalyst-core cli dbc-send EngineStatus --signal rpm=1500 --signal temp=80

# 5) escape hatch — 임의 명령
canalyst-core cli raw '{"type":"set_filter","ids":[256,512],"mask":1792}'
```

CLI 전역 옵션: `--url ws://127.0.0.1:8765`(또는 환경변수 `CANCTL_URL`), `--timeout 5.0`,
`--pretty`. 전체 명령은 `canalyst-core cli -h`, 개별 명령은 `... cli <명령> -h`.
`connect` 한 연결 상태는 데몬에 유지되므로 이어지는 호출을 각각 별도로 실행할 수 있습니다.

### MCP 서버 — AI가 도구로 자율 사용 (라이브 전용)

`canalyst-core mcp` 는 **로컬 MCP(stdio) 서버**입니다. 책임 경계는 *"실행 중 장치/세션이
살아있어야 하면 MCP, 끝난 산출물(캡처 파일)을 다루면 CLI."* 즉 MCP 는 **라이브 동작만**
노출하고, **디코드·포맷 변환·통계·export 는 하지 않습니다**(그건 캡처 파일을 받아 CLI 분석
단계가 담당 — 안 쓸 때도 스키마 토큰을 무는 것을 피하려는 의도).

라이브 도구 11종:

| 툴 | 설명 |
|---|---|
| `can_status` | 연결·필터·캡처 상태 |
| `can_connect` / `can_disconnect` | 장치 열기/닫기(bitrate 설정, 호출 간 유지) |
| `can_set_filter` | 라이브 수신 필터(빈 ids=전체) |
| `can_send` ⚠️ | 프레임 1회 송신(되돌릴 수 없음 · `dry_run` 미리보기) |
| `can_send_periodic` ⚠️ / `can_stop_periodic` | 주기 송신 시작/중지 |
| `can_start_capture` / `can_stop_capture` | 원시 기록 시작 / 종료(**저장 파일 절대경로 반환**) |
| `can_stream` | 유한 시간 라이브 프레임 수집(빠른 확인) |
| `can_wait_for` | 조건 프레임까지 대기(이벤트 트리거, 대기 중 토큰 ~0) |

**캡처→분석 핸드오프**: 대량/지속 데이터의 디코드·통계·변환은 `can_start_capture` 로
파일에 떨군 뒤, `can_stop_capture` 가 돌려준 **절대 경로**를 CLI 분석으로 넘깁니다.
`can_send`/`can_send_periodic` 은 실제 버스에 쏘는 위험 동작이라, 호스트(Claude Code)의 툴
승인으로 확인되며 `dry_run=True` 로 보낼 프레임을 먼저 미리볼 수 있습니다.

Claude Code 등록 예(`.mcp.json` 또는 settings 의 `mcpServers`):

```jsonc
{
  "mcpServers": {
    "canalyst": {
      // 개발: "command": "python", "args": ["-m", "canctl_core.mcp_server"]
      "command": "canalyst-core",
      "args": ["mcp", "--url", "ws://127.0.0.1:8765"]
    }
  }
}
```

> MCP 서버는 라이브 세션을 가진 **코어 데몬에 붙는 얇은 WS 클라이언트**입니다(집계 등
> 자체 상태 없음 — 디바이스/캡처 상태는 데몬에 산다). GUI 앱이 떠 있으면 그 사이드카
> (8765)에 붙고, **데몬이 없으면 `canalyst-core` 서버를 자식 프로세스로 자동 기동**해
> 세션 동안 소유합니다(플러그인 단독 동작). 장비 없이 테스트하려면 args 에 `--mock` 을
> 추가하세요. 자동 기동을 끄려면 `--no-autospawn`. 단일 클라이언트 가정(도구 순차 호출).
> MCP 모드는 `mcp` SDK 가 필요하므로 `pip install -e .[mcp]`.
>
> ⚠️ 동결(설치본) 바이너리의 `mcp` 모드는 PyInstaller 가 `mcp`/`pydantic` 를 번들해야
> 하며(빌드 시 `--collect-all mcp`), 현재 **실제 동결 빌드에서는 미검증**입니다. 개발
> 설치(`python -m canctl_core.mcp_server`)·`pip install -e .[mcp]` 의 `canalyst-core mcp`
> 는 검증되었습니다.

## WebSocket 프로토콜 (JSON, 한 줄 = 한 메시지)

| 방향 | 메시지 | 설명 |
|------|--------|------|
| C→S | `{type:"list_devices"}` | 장치 목록 요청 |
| C→S | `{type:"connect", device_index, channel, bitrate}` | 연결 |
| C→S | `{type:"disconnect"}` | 해제 |
| C→S | `{type:"send", channel, can_id, extended, rtr, data:[..]}` | 프레임 송신 |
| C→S | `{type:"set_filter", ids:[..]}` | 수신 ID 필터(빈 배열=전체 통과) |
| C→S | `{type:"start_log", path}` / `{type:"stop_log"}` | JSONL 프레임 로깅 시작/종료 |
| C→S | `{type:"replay", path}` | 기록 파일을 rx 스트림으로 재생 |
| C→S | `{type:"load_dbc", path}` | DBC 로드(cantools, rx에 신호 디코딩 부착) |
| S→C | `{type:"devices", list:[{index,name,channels}]}` | 장치 목록 |
| S→C | `{type:"status", connected, backend, device, channels}` | 상태 |
| S→C | `{type:"rx", frames:[{ts,channel,can_id,extended,rtr,dlc,data,decoded?}]}` | 수신(배칭, DBC 로드 시 `decoded` 부착) |
| S→C | `{type:"log_status", logging, path}` / `{type:"filter", ids}` | 로깅/필터 상태 통지 |
| S→C | `{type:"error", message}` | 오류 |

- `bitrate` 는 정수(10000~1000000 표준값 권장). UI는 드롭다운으로 입력합니다.
- 필터·로깅·replay 는 서버 레벨에서 동작하고, `load_dbc` 는 cantools(의존성 포함)로 CAN 신호를 디코딩합니다.

## 빌드 / 배포 패키징

설치 가능한 앱으로 만들려면 코어를 PyInstaller 단일 바이너리로 빌드한 뒤 electron-builder 로 묶습니다.

```bash
# 1) 코어 바이너리 (PyInstaller는 크로스 컴파일 불가 → 각 OS에서 각각 빌드)
cd core
pyinstaller --onefile --name canalyst-core --noconfirm \
  --collect-all canalystii --collect-all libusb_package --collect-all cantools \
  --collect-submodules can --collect-submodules canctl_core pyinstaller_entry.py
#   MCP 모드까지 동결하려면: pip install -e .[mcp] 후 위에 --collect-all mcp 추가
#   (mcp/pydantic 번들은 finicky — 동결 빌드 검증 필요)

# 2) Electron 앱 패키징 (코어 바이너리를 resources/core/ 로 동봉)
cd ../ui
npm run dist
```

`ui/electron-builder.yml` 의 `extraResources` 가 `core/dist` 를 앱의 `resources/core/` 로 복사하고,
패키징된 앱의 main 프로세스는 `process.resourcesPath/core/canalyst-core(.exe)` 를 사이드카로 실행합니다.
자세한 절차는 `scripts/build-core.md` 참고.

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
