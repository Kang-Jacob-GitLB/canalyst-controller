"""canalyst 플러그인 부트스트랩 — 코어(canalyst-core)를 자동 설치(멱등).

플러그인만 설치해도 (Python 3.10+ 와 git 이 PATH 에 있으면) 코어까지 자동으로 깔려
MCP 가 동작하게 한다. 우선순위:
  1) PATH 에 canalyst-core 가 이미 있으면 그걸 쓴다(전역 설치 존중).
  2) 부트스트랩 venv(${CLAUDE_PLUGIN_DATA}/venv)에 이미 설치돼 있으면 그걸 쓴다.
  3) 둘 다 없으면 venv 를 만들고 GitHub 에서 pip 설치한다.

요구(이 스크립트가 설치하지 못하는 것): 사용자 머신의 python(3.10+)·git. private
저장소면 pip 의 git 접근에 인증(SSH 키/토큰)이 필요하다.

SessionStart 훅으로도 호출되어(워밍업) 첫 MCP 기동을 빠르게 한다. 실패해도 세션을
막지 않는다(이 파일을 직접 실행하면 항상 exit 0).
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

#: GitHub 직접 설치(패키지는 레포 core/ 하위 → subdirectory 필수). PyPI 미등록.
GIT_SPEC = ("canalyst-core[mcp] @ "
            "git+https://github.com/Kang-Jacob-GitLB/canalyst-controller.git"
            "#subdirectory=core")


def plugin_data_dir() -> pathlib.Path:
    """플러그인 영속 데이터 디렉터리(업데이트 후에도 유지). 미설정 시 폴백."""
    env = os.environ.get("CLAUDE_PLUGIN_DATA")
    if env:
        return pathlib.Path(env)
    return pathlib.Path(__file__).resolve().parent.parent / ".data"


def _venv_python(venv: pathlib.Path) -> pathlib.Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def find_core() -> list[str] | None:
    """이미 쓸 수 있는 코어가 있으면 MCP 실행 argv 프리픽스를 반환, 없으면 None."""
    exe = shutil.which("canalyst-core")
    if exe:
        return [exe, "mcp"]
    py = _venv_python(plugin_data_dir() / "venv")
    if py.exists():
        probe = subprocess.run([str(py), "-c", "import canctl_core.mcp_server"],
                               capture_output=True)
        if probe.returncode == 0:
            return [str(py), "-m", "canctl_core.mcp_server"]
    return None


def ensure_installed() -> list[str]:
    """코어를 사용할 수 있게 보장하고 MCP 실행 argv 프리픽스를 반환(멱등).

    이미 있으면 즉시 반환. 없으면 venv 생성 + GitHub pip 설치(첫 실행은 수십 초~수 분).
    """
    found = find_core()
    if found:
        return found
    venv = plugin_data_dir() / "venv"
    py = _venv_python(venv)
    if not py.exists():
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
    subprocess.run([str(py), "-m", "pip", "install", "-q", "--upgrade", "pip"],
                   check=False)
    subprocess.run([str(py), "-m", "pip", "install", "-q", GIT_SPEC], check=True)
    return [str(py), "-m", "canctl_core.mcp_server"]


if __name__ == "__main__":
    try:
        argv = ensure_installed()
        sys.stderr.write(f"[canalyst] core 준비됨: {' '.join(argv)}\n")
    except Exception as exc:  # 워밍업 실패는 세션을 막지 않는다
        sys.stderr.write(
            f"[canalyst] 코어 자동 설치 실패: {exc}\n"
            "  → Python 3.10+ 와 git 이 PATH 에 있는지, GitHub 접근이 되는지 확인하세요.\n")
    sys.exit(0)
