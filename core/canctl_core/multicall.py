"""멀티콜 디스패처 — 단일 실행파일/명령이 첫 인자로 역할을 가른다.

동결 바이너리(`pyinstaller_entry.py`)와 pip 콘솔 스크립트(`canalyst-core`)가
이 함수를 공유하므로, 개발 환경과 설치본에서 **완전히 동일한 명령 규약**을 쓴다:

- `canalyst-core [--mock --host --port --log-level]` → WebSocket 서버
  (Electron 사이드카가 띄우는 기본 경로).
- `canalyst-core cli <명령> ...`                      → AI/스크립트용 CLI.
- `canalyst-core mcp [--url ...]`                     → 로컬 MCP 서버(stdio).

각 하위 main 은 지연 import 한다(필요한 쪽만 로드 — 예: mcp 미설치 시 서버/CLI 는
영향 없음). 서버 파서는 positional 인자를 받지 않으므로 'cli'/'mcp' 는 충돌 없는
분기 토큰이다.
"""
from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else list(argv)
    if args and args[0] == "cli":
        from .cli import main as cli_main
        cli_main(args[1:])
    elif args and args[0] == "mcp":
        from .mcp_server import main as mcp_main
        mcp_main(args[1:])
    else:
        from .__main__ import main as server_main
        server_main(args)


if __name__ == "__main__":
    main()
