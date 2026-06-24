# canalyst — Claude 플러그인

CANalyst-II CAN 버스를 Claude가 **라이브 제어**할 수 있게 해주는 MCP 플러그인입니다.
connect/send/capture/stream/wait_for 등 라이브 동작을 도구로 노출합니다(캡처 파일의
디코드·통계·변환 같은 사후 분석은 이 플러그인이 아니라 별도 CLI 가 담당).

## 전제: 코어(`canalyst-core`) 설치

플러그인은 `canalyst-core mcp` 명령에 위임합니다. 따라서 그 명령이 **PATH 에 있어야**
합니다. 코어를 설치하면 `canalyst-core` 콘솔 스크립트가 등록됩니다:

```bash
# (A) 외부 사용자 — 클론 없이 GitHub 에서 직접 설치
pip install "canalyst-core[mcp] @ git+https://github.com/Kang-Jacob-GitLB/canalyst-controller.git#subdirectory=core"

# (B) 개발 — 클론 후 편집 가능 설치
git clone https://github.com/Kang-Jacob-GitLB/canalyst-controller.git
cd canalyst-controller/core && pip install -e ".[mcp]"

# 확인 (둘 다 canalyst-core 콘솔 스크립트를 PATH 에 등록 + MCP 의존성 설치)
canalyst-core mcp --help
```

> 이 패키지는 **PyPI 에 없습니다** — GitHub 에서 받으며, `pyproject.toml` 이 `core/` 하위라
> **`#subdirectory=core` 가 필수**입니다(빼면 설치 실패). 저장소가 private 이면 pip 와
> `/plugin marketplace add` 둘 다 GitHub 인증(SSH 키/토큰)이 필요합니다.

> 데스크톱 앱 설치본에 동봉된 바이너리(`<resources>/core/canalyst-core(.exe)`)를 쓰려면
> 그 경로를 PATH 에 추가하거나, `.mcp.json` 의 `command` 를 절대경로로 바꾸세요.
> (동결 바이너리의 mcp 모드는 현재 미검증 — `scripts/build-core.md` 참고.)

## 설치

```text
# 1) 이 저장소를 마켓플레이스로 추가
/plugin marketplace add Kang-Jacob-GitLB/canalyst-controller

# 2) 플러그인 설치
/plugin install canalyst@canalyst-controller
```

## 동작 방식

- 플러그인의 MCP 서버는 코어 데몬(`ws://127.0.0.1:8765`)에 붙는 얇은 클라이언트입니다.
- GUI 앱이 실행 중이면 그 사이드카에 붙어 **공존**하고, 데몬이 없으면 `canalyst-core`
  서버를 자식 프로세스로 **자동 기동**합니다(플러그인 단독 동작).
- 디바이스·캡처·필터 상태는 데몬에 유지되어 도구 호출 간 살아있습니다.

## 장비 없이 시험(mock)

`.mcp.json` 의 args 를 `["mcp", "--mock"]` 로 바꾸면 자동 기동하는 데몬이 가짜 CAN
트래픽을 내보내, 실장비 없이 도구를 시험할 수 있습니다.

## ⚠️ 송신 주의

`can_send`/`can_send_periodic` 은 **실제 버스로 프레임을 쏘는 되돌릴 수 없는 동작**입니다.
호스트(Claude Code)의 도구 승인으로 확인되며, `dry_run=True` 로 보낼 프레임을 먼저
미리볼 수 있습니다.

## 제공 도구(라이브 11종)

`can_status`, `can_connect`, `can_disconnect`, `can_set_filter`, `can_send`,
`can_send_periodic`, `can_stop_periodic`, `can_start_capture`, `can_stop_capture`,
`can_stream`, `can_wait_for`.
