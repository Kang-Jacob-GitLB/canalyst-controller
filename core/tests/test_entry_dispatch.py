"""멀티콜 디스패처 테스트(canalyst-core: server | cli | mcp).

실제 하위 main 들은 monkeypatch 로 가로채 호출 인자만 검사한다(서버/MCP 를 띄우지 않음).
multicall 은 지연 import 라 patch 가 호출 시점에 반영된다. pyinstaller_entry 가 같은
디스패처에 위임하는지도 sys.argv 경로로 확인한다.
"""
import sys

import pyinstaller_entry
from canctl_core import multicall


def _patch(monkeypatch):
    called = {}
    monkeypatch.setattr("canctl_core.cli.main",
                        lambda argv=None: called.__setitem__("cli", argv))
    monkeypatch.setattr("canctl_core.__main__.main",
                        lambda argv=None: called.__setitem__("server", argv))
    monkeypatch.setattr("canctl_core.mcp_server.main",
                        lambda argv=None: called.__setitem__("mcp", argv))
    return called


def test_cli_branch(monkeypatch):
    c = _patch(monkeypatch)
    multicall.main(["cli", "status", "--url", "ws://x"])
    assert c["cli"] == ["status", "--url", "ws://x"]
    assert "server" not in c and "mcp" not in c


def test_mcp_branch(monkeypatch):
    c = _patch(monkeypatch)
    multicall.main(["mcp", "--url", "ws://x"])
    assert c["mcp"] == ["--url", "ws://x"]
    assert "cli" not in c and "server" not in c


def test_server_branch_with_flags(monkeypatch):
    c = _patch(monkeypatch)
    multicall.main(["--mock", "--port", "8800"])
    assert c["server"] == ["--mock", "--port", "8800"]
    assert "cli" not in c and "mcp" not in c


def test_no_args_is_server(monkeypatch):
    c = _patch(monkeypatch)
    multicall.main([])
    assert "server" in c
    assert "cli" not in c and "mcp" not in c


def test_pyinstaller_entry_delegates_via_sys_argv(monkeypatch):
    c = _patch(monkeypatch)
    monkeypatch.setattr(sys, "argv", ["canalyst-core", "cli", "devices"])
    pyinstaller_entry.main()
    assert c["cli"] == ["devices"]
