"""canalyst MCP 런처 — 코어 설치를 보장한 뒤 MCP 서버(stdio)를 실행한다.

`.mcp.json` 의 command 로 지정된다. 이미 설치돼 있으면 즉시 실행(빠름), 처음이면
부트스트랩한다(첫 실행은 GitHub pip 설치로 수십 초~수 분 — 이때 MCP 초기화가 지연될 수
있으니 SessionStart 훅이 미리 워밍업한다). 추가 인자는 그대로 MCP 서버로 전달한다
(예: `--url`, `--mock`).
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from canalyst_bootstrap import ensure_installed  # noqa: E402

try:
    argv = ensure_installed()
except Exception as exc:
    sys.stderr.write(
        f"[canalyst] 코어 설치 실패: {exc}. Python 3.10+ 와 git 이 PATH 에 있는지, "
        "GitHub 접근이 되는지 확인하세요(또는 코어를 수동 설치).\n")
    sys.exit(1)

# stdio 를 그대로 물려주고 MCP 서버를 자식으로 실행한다(execv 의 Windows 파이프 이슈 회피).
result = subprocess.run([*argv, *sys.argv[1:]])
sys.exit(result.returncode)
