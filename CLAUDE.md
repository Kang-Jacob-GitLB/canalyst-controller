# CLAUDE.md — canalyst-controller 개발 가이드

CANalyst-II 제어 데스크톱 앱. Python 코어(CAN + WebSocket) + Electron/React UI 구조.

## 진입점

배포 실행파일/명령 이름은 **`canalyst-core`**(멀티콜), 파이썬 import 패키지명은
호환을 위해 **`canctl_core`** 유지. 멀티콜 분기는 `canctl_core/multicall.py` 가 담당하고,
동결 바이너리(`pyinstaller_entry.py`)와 pip 콘솔 스크립트(`canalyst-core`)가 이를 공유:

- 서버: `canalyst-core [--mock --port 8765]` (= `python -m canctl_core`).
  Electron 사이드카가 띄우는 기본 경로. `core/canctl_core/__main__.py`.
- CLI: `canalyst-core cli <명령>` (= `python -m canctl_core.cli`). 실행 중인 데몬에 WS
  로 프로토콜 명령을 보내고 JSON 을 stdout 으로 출력하는 얇은 클라이언트(AI/스크립트용).
  서브커맨드는 `VALID_COMMANDS` 전체 + `monitor`/`serve`/`raw`. **원칙: 어떤 명령도 hang
  되지 않는다**(monitor 유한, 데몬 미기동 즉시 실패, 모든 대기는 응답|error|timeout 으로
  종료, cp949 안전한 `ensure_ascii` JSON). 종료코드 0/1/3/4. `core/canctl_core/cli.py`.
- MCP: `canalyst-core mcp` (= `python -m canctl_core.mcp_server`). 로컬 MCP(stdio) 서버.
  **라이브 전용 어댑터** — 경계: *"세션이 살아있어야 하면 MCP, 끝난 산출물(캡처 파일)이면
  CLI."* 라이브 11툴(connect/disconnect/set_filter/send(+dry_run)/send_periodic/
  stop_periodic/start_capture/stop_capture/stream/wait_for/status)만 노출하고 **디코드·
  변환·통계·export 는 안 한다**(캡처 파일을 CLI 가 분석). `can_stop_capture` 는 저장 파일의
  **절대경로**를 반환(분석 핸드오프). 데몬에 붙는 얇은 WS 클라(자체 도메인 상태 없음 —
  세션 상태는 데몬에 산다). 단일 reader 멀티플렉스 + cmd_lock(상관관계 ID 없음 → 단일
  클라이언트 가정). **데몬이 없으면 `canalyst-core` 서버를 자식으로 autospawn**(있으면 붙어
  GUI 와 공존; `--mock`/`--no-autospawn` 옵션). `core/canctl_core/mcp_server.py`.
  **mcp SDK 는 옵션 의존성**(`[mcp]` extra) — 동결 바이너리에 넣으려면 빌드 시
  `pip install -e .[mcp]` + `--collect-all mcp`(mcp/pydantic 번들 finicky, **동결 빌드
  미검증** — 개발 설치는 검증됨).
- 분석 로직(통계 등)은 **core 에만** 둔다(어댑터에 중복 금지): `core/canctl_core/aggregator.py`
  의 `RxAggregator`(프레임 (channel,can_id)별 통계)는 이후 CLI 의 캡처 파일 분석용 core
  유틸이다(MCP 는 사용하지 않음).
- 코어 바이너리는 `--collect-submodules canctl_core` 로 cli/mcp 모듈까지 번들 → 설치본
  `<resources>/core/canalyst-core(.exe) cli|mcp ...` 로 동일 사용. 서버 파서는
  positional 이 없어 `cli`/`mcp` 는 충돌 없는 분기 토큰.
- UI: `ui/src/main/index.js`(Electron main) → 앱 시작 시 코어를 사이드카로 spawn
  (`resources/core/canalyst-core`).

## WebSocket 프로토콜 (JSON, 한 줄=한 메시지)

### Client→Server 명령
- 연결: `list_devices` / `connect{device_index,channel,bitrate,bitrate1?}` / `disconnect` — **connect 는 장비의 두 채널(0,1)을 모두 열어** 어느 채널로든 송수신이 가능하다(`channel` 필드는 프로토콜 호환용으로 유지되나 채널 선택에는 쓰이지 않음). `bitrate`=채널0, `bitrate1`=채널1 비트레이트로 **채널별 독립 속도**를 지원한다(`bitrate1` 생략 시 `bitrate` 와 동일 = 두 채널 같은 속도, 하위호환). 두 값 모두 드라이버 지원 표준값(10000/20000/.../1000000)이어야 한다.
- 송신: `send{channel,can_id,extended,rtr,data:[..]}`
- 주기 송신: `send_periodic{channel,can_id,extended?,rtr?,data?,period,count?}` / `stop_periodic{id?}` — `period`(초, 0 초과)마다 프레임을 반복 송신. `count` 생략 시 무한, 지정 시 그 횟수만큼. `stop_periodic` 의 `id` 생략 시 전체 중지. **코어 asyncio 타이머 기반**(canalystii 가 하드웨어 주기송신을 노출하지 않아 소프트웨어 타이밍 — 고부하 시 약간의 지터). disconnect/재connect 시 자동 정리. 각 송신은 `rx`(dir=tx)로 echo.
- 수신 필터: `set_filter{ids:[..],mask?,channel?}` — 빈 `ids`=전체 통과. `mask` 생략 시 정확 일치(all-ones), `channel` 생략/null 시 전체 채널. **set_filter는 필터 전체를 교체**(미지정 항목은 기본값으로 리셋).
- 로깅·재생: `start_log{path}` / `stop_log` / `replay{path}` — 기록 포맷은 JSONL(한 줄=한 프레임). `replay` 는 우리 JSONL 외에 **외부 표준 로그(.asc/.blf/.trc/.mf4)도 확장자로 인식**해 재생(python-can `LogReader`).
- 로그 내보내기: `export_log{src,dest,format:"asc"|"csv"|"blf"}` — 기록된 JSONL을 표준 포맷(Vector ASC / candump식 CSV / Vector BLF)으로 변환.
- DBC: `load_dbc{path}` / `list_dbc_messages` / `encode_send{message,signals:{신호명:값},channel}` — 신호값을 인코딩해 프레임으로 송신.

### Server→Client 이벤트
- `devices{list}` / `status{connected,backend,device,channels}` — 연결 시 `device`={index,name,bitrate,bitrate1}(bitrate=채널0, bitrate1=채널1 속도; 같은 속도로 열면 둘이 같다), `channels`=[0,1] 채워짐(미연결·미구현 백엔드는 null).
- `rx{frames:[{ts,channel,can_id,extended,rtr,dlc,data,dir,decoded?}]}`(배칭) — `dir`은 `"rx"`/`"tx"`, DBC 로드 시 각 프레임에 `decoded{message,signals}` 부착.
- `error{message}`
- `log_status{logging,path}` / `filter{ids,mask,channel}`(현재 필터 통지)
- `periodic_status{tasks:[{id,channel,can_id,extended,rtr,data,period,count,sent}]}` — 진행 중인 주기 송신 목록(send_periodic/stop_periodic 결과). 빈 목록=진행 중 없음.
- `dbc_messages{messages:[{name,frame_id,is_extended,length,signals:[{name,minimum,maximum,unit}]}]}`
- `export_status{ok,path,count,format}`

### 참고
- `bitrate`/`bitrate1`은 정수이며 **드라이버 `TIMINGS` 표의 표준값만** 받는다(10000/20000/50000/100000/125000/250000/500000/800000/1000000 등 — 임의값은 거부). UI는 드롭다운/사용자 지정 입력, "채널별 다른 속도" 토글로 채널1 속도를 따로 지정. 채널별 다른 속도는 채널1 만 드라이버 `init` 재호출로 덮어써 적용한다.
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
