"""canctl CLI 테스트.

- 순수 파서/빌더(auto_int/data_byte/parse_signals/_frame_command)는 단위 테스트.
- 요청/응답 상관(타입 매칭) 검증은 단위 테스트로는 증명되지 않으므로, mock 서버를
  **임의(ephemeral) 포트**에 인프로세스로 띄워 실제 WS 왕복으로 확인한다(8765 와
  충돌하지 않게). connect/send/monitor/send-periodic 등 경합 위험이 있는 경로를 본다.

pytest-asyncio 미설치 환경이므로, 서버는 별도 스레드의 자체 이벤트 루프에서 돌리고
CLI(`cli.main`)는 메인 스레드에서 `asyncio.run` 으로 구동한다(서로 다른 루프).
"""
import argparse
import json
import socket
import threading
import time

import pytest

from canctl_core import cli
from canctl_core.mock_backend import MockBackend
from canctl_core.server import CanServer


# --- 순수 파서/빌더 단위 테스트 ------------------------------------------

def test_auto_int_hex_and_decimal():
    assert cli.auto_int("0x123") == 0x123
    assert cli.auto_int("291") == 291
    assert cli.auto_int("0b1010") == 10


def test_auto_int_rejects_non_int():
    with pytest.raises(argparse.ArgumentTypeError):
        cli.auto_int("xyz")


def test_data_byte_range():
    assert cli.data_byte("0xFF") == 255
    assert cli.data_byte("0") == 0
    with pytest.raises(argparse.ArgumentTypeError):
        cli.data_byte("256")
    with pytest.raises(argparse.ArgumentTypeError):
        cli.data_byte("-1")


def test_parse_signals_int_and_float():
    sig = cli.parse_signals(["rpm=1500", "ratio=0.5", "flag=0x01"])
    assert sig == {"rpm": 1500, "ratio": 0.5, "flag": 1}


def test_parse_signals_bad_format():
    with pytest.raises(cli.CliError):
        cli.parse_signals(["noequals"])
    with pytest.raises(cli.CliError):
        cli.parse_signals(["x=abc"])


def test_frame_command_builder():
    args = argparse.Namespace(channel=1, can_id=0x123, ext=True, rtr=False,
                              data=[1, 2, 3])
    cmd = cli._frame_command("send", args)
    assert cmd == {"type": "send", "channel": 1, "can_id": 0x123,
                   "extended": True, "rtr": False, "data": [1, 2, 3]}


def test_parser_send_parses_hex_and_data():
    parser = cli.build_parser()
    args = parser.parse_args(["send", "0x123", "--data", "0x01", "10", "--ext"])
    assert args.command == "send"
    assert args.can_id == 0x123
    assert args.data == [1, 10]
    assert args.ext is True


# --- 인프로세스 mock 서버 픽스처 -----------------------------------------

def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_port(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.03)
    raise RuntimeError(f"서버가 {timeout}s 안에 뜨지 않았습니다(port={port})")


class _ServerThread:
    """mock 서버를 별도 스레드의 자체 루프에서 run_forever 로 구동."""

    def __init__(self, port: int):
        self.port = port
        self.server = CanServer(MockBackend(), host="127.0.0.1", port=port)
        self.loop = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        import asyncio
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.call_soon(self._ready.set)
        try:
            self.loop.run_until_complete(self.server.run_forever())
        finally:
            self.loop.close()

    def start(self):
        self._thread.start()
        self._ready.wait(5)
        _wait_port(self.port)

    def stop(self):
        if self.server._stop is not None and self.loop is not None:
            self.loop.call_soon_threadsafe(self.server._stop.set)
        self._thread.join(5)


@pytest.fixture()
def server():
    st = _ServerThread(_free_port())
    st.start()
    try:
        yield st
    finally:
        st.stop()


def run_cli(capsys, argv):
    """cli.main 을 실행하고 (exit_code, stdout_json, stderr) 반환."""
    with pytest.raises(SystemExit) as ei:
        cli.main(argv)
    captured = capsys.readouterr()
    code = ei.value.code if ei.value.code is not None else 0
    out = json.loads(captured.out) if captured.out.strip() else None
    return code, out, captured.err


# --- 통합: 데몬 미기동 시 즉시 실패 --------------------------------------

def test_unreachable_fails_fast(capsys):
    port = _free_port()  # 아무도 듣지 않는 포트
    code, out, err = run_cli(
        capsys, ["--url", f"ws://127.0.0.1:{port}", "--timeout", "1.0", "status"])
    assert code == cli.EXIT_UNREACHABLE
    # stderr 는 ensure_ascii=True 라 한글이 \uXXXX 로 이스케이프된다(cp949 안전).
    # JSON 으로 파싱하면 원래 한글로 디코딩되어 안내 메시지를 검증할 수 있다.
    parsed = json.loads(err)
    assert parsed["type"] == "error"
    assert "데몬" in parsed["message"]
    assert "canctl_core --mock" in parsed["message"]


# --- 통합: 핵심 왕복(경합 위험 경로) -------------------------------------

def test_status_before_connect(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    code, out, _ = run_cli(capsys, ["--url", url, "status"])
    assert code == 0
    assert out["type"] == "status"
    assert out["connected"] is False
    assert out["backend"] == "mock"


def test_devices(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    code, out, _ = run_cli(capsys, ["--url", url, "devices"])
    assert code == 0
    assert out["type"] == "devices"
    assert out["list"][0]["name"] == "Mock CANalyst-II"


def test_connect_then_send_echoes_tx(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    # connect → status connected=true
    code, out, _ = run_cli(capsys, ["--url", url, "connect", "0", "--bitrate", "500000"])
    assert code == 0
    assert out["connected"] is True
    assert out["device"]["bitrate"] == 500000

    # send → tx echo 프레임이 돌아온다(경합: mock rx 스트림과 섞임)
    code, out, _ = run_cli(
        capsys, ["--url", url, "send", "0x123", "--data", "0x01", "0x02", "0x03"])
    assert code == 0
    assert out["ok"] is True
    assert out["frame"]["can_id"] == 0x123
    assert out["frame"]["dir"] == "tx"
    assert out["frame"]["data"] == [1, 2, 3]


def test_reconnect_reports_fresh_bitrate(server, capsys):
    # 이미 연결된 상태에서 재연결(bitrate 변경) 시, 연결 직후의 '낡은' status 가 아니라
    # 새로 처리된 status 를 돌려줘야 한다(CLAUDE.md: bitrate 변경은 재연결로 한다).
    url = f"ws://127.0.0.1:{server.port}"
    code, out, _ = run_cli(capsys, ["--url", url, "connect", "0", "--bitrate", "500000"])
    assert code == 0 and out["device"]["bitrate"] == 500000

    code, out, _ = run_cli(capsys, ["--url", url, "connect", "0", "--bitrate", "250000"])
    assert code == 0
    assert out["connected"] is True
    assert out["device"]["bitrate"] == 250000  # 낡은 500000 이 아니라 새 값


def test_send_without_connect_surfaces_server_error(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    # 연결 안 된 상태에서 send → mock 이 RuntimeError → 서버 error → exit 1
    code, out, err = run_cli(capsys, ["--url", url, "send", "0x123", "--data", "1"])
    assert code == cli.EXIT_SERVER_ERROR
    assert err  # error JSON 이 stderr 로 나온다


def test_monitor_is_bounded_and_collects(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    run_cli(capsys, ["--url", url, "connect", "0"])  # 연결해야 mock 이 프레임 생성
    code, out, _ = run_cli(capsys, ["--url", url, "monitor", "--duration", "0.4"])
    assert code == 0
    assert out["type"] == "monitor"
    assert out["count"] >= 1  # mock 이 0.1s 마다 0x100 등을 낸다
    assert out["count"] == len(out["frames"])


def test_monitor_count_early_stop(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    run_cli(capsys, ["--url", url, "connect", "0"])
    code, out, _ = run_cli(
        capsys, ["--url", url, "monitor", "--duration", "3.0", "--count", "2",
                 "--ids", "0x100"])
    assert code == 0
    assert out["count"] == 2
    assert all(f["can_id"] == 0x100 for f in out["frames"])


def test_send_periodic_then_stop(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    run_cli(capsys, ["--url", url, "connect", "0"])
    # 주기 송신 시작 → periodic_status 에 우리 태스크가 보인다
    code, out, _ = run_cli(
        capsys, ["--url", url, "send-periodic", "0x321", "--data", "0xAA",
                 "--period", "0.05"])
    assert code == 0
    assert out["type"] == "periodic_status"
    assert any(t["can_id"] == 0x321 for t in out["tasks"])

    # 전체 중지 → 빈 목록
    code, out, _ = run_cli(capsys, ["--url", url, "stop-periodic"])
    assert code == 0
    assert out["type"] == "periodic_status"
    assert out["tasks"] == []


def test_filter_roundtrip(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    code, out, _ = run_cli(
        capsys, ["--url", url, "filter", "--ids", "0x100", "0x200"])
    assert code == 0
    assert out["type"] == "filter"
    assert sorted(out["ids"]) == [0x100, 0x200]


def test_raw_escape_hatch(server, capsys):
    url = f"ws://127.0.0.1:{server.port}"
    code, out, _ = run_cli(
        capsys, ["--url", url, "--timeout", "0.5", "raw", '{"type":"list_devices"}'])
    assert code == 0
    assert out["type"] == "raw_result"
    assert any(m.get("type") == "devices" for m in out["messages"])
