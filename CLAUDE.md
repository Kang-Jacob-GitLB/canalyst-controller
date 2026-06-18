# CLAUDE.md — canalyst-controller 개발 가이드

CANalyst-II 제어 데스크톱 앱. Python 코어(CAN + WebSocket) + Electron/React UI 구조.

## 진입점

- 코어: `core/canctl_core/__main__.py` → `python -m canctl_core [--mock] [--port 8765]`
- UI: `ui/src/main/index.js`(Electron main) → 앱 시작 시 Python 코어를 사이드카로 spawn

## WebSocket 프로토콜 (JSON, 한 줄=한 메시지)

- Client→Server: `list_devices` / `connect{device_index,channel,bitrate}` / `disconnect` /
  `send{channel,can_id,extended,rtr,data:[..]}`
- Server→Client: `devices{list}` / `status{connected,backend,device,channels}` /
  `rx{frames:[{ts,channel,can_id,extended,rtr,dlc,data}]}`(배칭) / `error{message}`
- `bitrate`는 정수(125000/250000/500000/1000000 등 표준값). UI는 드롭다운으로 입력.
- 한계: canalystii는 송신 ACK/버스에러 보고 불가 → TX는 "큐잉됨" 수준만 반영.

## 코드 컨벤션

- Python: 함수/변수 `snake_case`, 클래스 `PascalCase`, 상수 `UPPER_CASE`. 주석/문서 **한글**.
- JS/React: 컴포넌트 `PascalCase`, 훅 `useXxx`, 그 외 `camelCase`.
- 백엔드는 `CanBackend` 추상클래스로 분리(mock ↔ canalystii 교체 가능). USB 프로토콜 직접 재구현 금지(python-can 사용).

## 커밋 규칙

- 형식: `{type}: 제목` (한글, 72자 이내). type ∈ feat, fix, refactor, test, docs, chore, ci
- 기본 브랜치: `main`
- 커밋 메시지 끝에: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## 주의

- **Windows USB 드라이버**: 실장비는 pyusb 접근을 위해 Zadig로 WinUSB 드라이버 교체 필요(벤더 SW와 충돌 가능).
- **고부하**: 1Mbps 시 ~7800 msg/s → 코어에서 폴링·배칭 후 push, UI는 표시 상한.
- **사이드카 수명**: Electron 종료 시 Python 프로세스 확실히 종료.
