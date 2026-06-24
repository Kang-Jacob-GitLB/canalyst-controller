---
name: canalyst
description: CANalyst-II(USB-CAN 분석기)로 CAN 버스를 라이브 제어할 때 사용한다 — 장치 연결(connect), CAN 프레임 송신(send), 수신 필터 설정, 트래픽 캡처 시작/종료, 실시간 프레임 관찰(stream)·이벤트 대기(wait_for). "CAN 보내줘/쏴줘", "CAN 모니터", "버스 캡처", "비트레이트 연결", "CANalyst" 등의 요청에 사용. 캡처 파일의 디코드·통계·변환 같은 사후 분석은 이 도구가 아니라 CLI 가 한다.
---

# canalyst — CAN 버스 라이브 제어

`canalyst` MCP 서버의 `can_*` 도구로 CANalyst-II 장치를 실시간 제어한다. 이 도구는
**라이브 동작만** 한다(경계: *"세션이 살아있어야 하면 MCP, 끝난 산출물이면 CLI"*).

## 기본 흐름

1. `can_status` 로 연결 상태 확인.
2. `can_connect(device_index=0, bitrate=...)` 로 장치 연결(두 채널 0,1 이 같은 bitrate 로
   열린다). 비트레이트를 바꾸려면 다른 값으로 다시 연결.
3. 송신: `can_send(can_id, data=[...])`. 주기 송신: `can_send_periodic(can_id, period, ...)`
   → `can_stop_periodic`.
4. 관찰: 짧은 확인은 `can_stream(duration, [count], [ids])`(유한 수집) 또는
   `can_wait_for(can_id=..., timeout=...)`(조건 프레임까지 대기).
5. 기록: `can_start_capture([path])` → `can_stop_capture`(저장 파일 **절대경로** 반환).
6. `can_set_filter(ids=[...])` 로 수신 필터(빈 ids=전체 통과).

`can_id` 는 정수다(`0x123` == `291`). 도구는 한 번에 하나씩 순차 호출한다.

## ⚠️ 송신은 위험 동작

`can_send`/`can_send_periodic` 은 **실제 버스로 프레임을 쏘는 되돌릴 수 없는 동작**이다
(실차/실장비에 영향). 확신이 없으면 먼저 `can_send(..., dry_run=True)` 로 보낼 프레임을
확인해 사용자에게 보여준 뒤, 동의를 받고 실제로 보낸다.

## 캡처 → 분석 핸드오프

대량/지속 데이터를 분석할 때는 이 도구로 **디코드·통계·변환을 하지 않는다.**
`can_start_capture` 로 파일에 기록하고, `can_stop_capture` 가 돌려준 **절대 경로**를
이후 분석(.dbc 디코드, 통계, ASC/CSV/BLF 변환)으로 넘긴다 — 분석은 `canalyst` CLI 의 몫이다.
`can_stream` 은 "지금 무슨 ID 가 흐르나" 같은 **빠른 현장 확인용**이지 대량 분석용이 아니다.

## 데몬·전제

MCP 서버는 코어 데몬(`ws://127.0.0.1:8765`)에 붙는 얇은 클라이언트다. GUI 앱이 실행
중이면 그 사이드카에 붙어 공존하고, 없으면 데몬을 자동 기동한다. **`canalyst-core` 코어가
설치돼 있어야 한다**(플러그인 README 참고). 장비 없이 시험하려면 데몬을 mock 으로 띄운다.
