# CLAUDE.md — canalyst-controller 개발 가이드

CANalyst-II 제어 데스크톱 앱. Python 코어(CAN + WebSocket) + Electron/React UI 구조.

## 진입점

- 코어: `core/canctl_core/__main__.py` → `python -m canctl_core [--mock] [--port 8765]`
- UI: `ui/src/main/index.js`(Electron main) → 앱 시작 시 Python 코어를 사이드카로 spawn

## WebSocket 프로토콜 (JSON, 한 줄=한 메시지)

### Client→Server 명령
- 연결: `list_devices` / `connect{device_index,channel,bitrate}` / `disconnect` — **connect 는 장비의 두 채널(0,1)을 모두 같은 `bitrate` 로 열어** 어느 채널로든 송수신이 가능하다(`channel` 필드는 프로토콜 호환용으로 유지되나 채널 선택에는 쓰이지 않음). 채널별 비트레이트는 미지원.
- 송신: `send{channel,can_id,extended,rtr,data:[..]}`
- 수신 필터: `set_filter{ids:[..],mask?,channel?}` — 빈 `ids`=전체 통과. `mask` 생략 시 정확 일치(all-ones), `channel` 생략/null 시 전체 채널. **set_filter는 필터 전체를 교체**(미지정 항목은 기본값으로 리셋).
- 로깅·재생: `start_log{path}` / `stop_log` / `replay{path}` (기록 포맷은 JSONL, 한 줄=한 프레임)
- 로그 내보내기: `export_log{src,dest,format:"asc"|"csv"}` — 기록된 JSONL을 표준 포맷(Vector ASC / candump식 CSV)으로 변환. (blf 미지원)
- DBC: `load_dbc{path}` / `list_dbc_messages` / `encode_send{message,signals:{신호명:값},channel}` — 신호값을 인코딩해 프레임으로 송신.

### Server→Client 이벤트
- `devices{list}` / `status{connected,backend,device,channels}`
- `rx{frames:[{ts,channel,can_id,extended,rtr,dlc,data,dir,decoded?}]}`(배칭) — `dir`은 `"rx"`/`"tx"`, DBC 로드 시 각 프레임에 `decoded{message,signals}` 부착.
- `error{message}`
- `log_status{logging,path}` / `filter{ids,mask,channel}`(현재 필터 통지)
- `dbc_messages{messages:[{name,frame_id,is_extended,length,signals:[{name,minimum,maximum,unit}]}]}`
- `export_status{ok,path,count,format}`

### 참고
- `bitrate`는 정수(125000/250000/500000/1000000 등 표준값 + 사용자 지정 임의값). UI는 드롭다운/사용자 지정 입력.
- 한계: canalystii는 송신 ACK/버스에러 보고 불가 → TX는 "큐잉됨" 수준만 반영. CAN FD·다중 장치 자동열거 미지원.

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
