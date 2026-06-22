"""종료 경로 회귀 테스트: stdin 감시 데몬 스레드가 인터프리터 finalize 를
크래시시키지 않아야 한다.

회귀 대상 버그
--------------
stdin 을 ``sys.stdin.buffer.read(1)`` 로 블로킹 감시하던 데몬 스레드가
BufferedReader 버퍼 락을 쥔 채 블로킹돼 있을 때, stdin EOF 가 아닌 경로
(포트 bind 실패·SIGINT/SIGTERM 등)로 코어가 종료되면 인터프리터 finalize 가
그 락을 회수하지 못해 ``Fatal Python error: _enter_buffered_busy``(Windows
종료코드 0xC0000005)로 죽었다. ``os.read(fd)`` 저수준 읽기로 바꿔 해결했다.

이 크래시는 **실제 인터프리터 종료 시점**에만 재현되므로 in-process 가 아니라
서브프로세스로 코어를 띄워 검증한다.
"""
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

# tests/ -> core/  (canctl_core 패키지가 있는 디렉터리). 서브프로세스를 이 cwd
# 로 띄워야 editable 설치본(다른 체크아웃)이 아닌 이 소스 트리의 canctl_core 를
# import 한다(-m 은 cwd 를 sys.path 최우선에 둔다).
CORE_DIR = Path(__file__).resolve().parent.parent

# Windows 액세스 위반 종료 코드(0xC0000005). subprocess.wait() 는 이를 부호 없는
# DWORD(3221225477)로, .NET 등은 부호 있는 int32(-1073741819)로 보고하므로
# 비교 시 항상 ``returncode & 0xFFFFFFFF`` 로 정규화해 두 표현을 모두 잡는다.
STATUS_ACCESS_VIOLATION = 0xC0000005


def test_bind_failure_shuts_down_without_fatal_error(tmp_path):
    """포트가 점유돼 bind 가 실패해도 fatal crash 없이 정상(비0) 코드로 종료.

    Electron 사이드카와 동일하게 stdin 을 PIPE(=非tty)로 열고 **닫지 않는다**.
    (stdin 을 닫으면 EOF 가 전달돼 graceful 경로로 빠지므로 버그가 재현되지
    않는다 — 반드시 열린 채로 둬야 감시 스레드가 read 에 블로킹된 상태에서
    bind 실패 종료 경로를 탄다.)
    """
    # 1) 포트를 점유해 코어의 websockets bind 를 결정적으로 실패시킨다.
    #    (Windows asyncio 는 기본적으로 SO_REUSEADDR 를 켜지 않으므로 단순
    #     bind+listen 만으로 두 번째 bind 가 WSAEADDRINUSE(10048)로 실패한다.)
    occupier = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupier.bind(("127.0.0.1", 0))
    occupier.listen(1)
    port = occupier.getsockname()[1]

    err_path = tmp_path / "core_stderr.txt"
    err_file = open(err_path, "wb")
    proc = None
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "canctl_core", "--mock", "--port", str(port)],
            cwd=str(CORE_DIR),
            stdin=subprocess.PIPE,       # Electron 처럼 pipe. 닫지 않는다(=EOF 미전달).
            stdout=subprocess.DEVNULL,
            stderr=err_file,
        )
        try:
            returncode = proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise AssertionError("코어가 종료되지 않음(20s 타임아웃)")
    finally:
        err_file.close()
        occupier.close()
        if proc is not None and proc.stdin:
            try:
                proc.stdin.close()
            except OSError:
                pass

    stderr_text = err_path.read_text(encoding="utf-8", errors="replace")

    # 핵심 회귀 단언: 액세스 위반(0xC0000005)으로 죽지 않아야 한다.
    assert (returncode & 0xFFFFFFFF) != STATUS_ACCESS_VIOLATION, (
        f"fatal crash(0xC0000005)로 종료됨(returncode={returncode}). stderr:\n{stderr_text}")
    # 데몬 스레드 버퍼 락 fatal error 출력이 없어야 한다.
    assert "Fatal Python error" not in stderr_text, (
        f"fatal error 출력됨:\n{stderr_text}")
    assert "_enter_buffered_busy" not in stderr_text, (
        f"버퍼 락 fatal error 출력됨:\n{stderr_text}")
    # bind 실패 자체는 정상적으로 표면화돼야 한다(회귀로 경로가 사라지지 않게).
    assert returncode != 0, "bind 실패인데 0 으로 종료됨(예상과 다름)"


def test_stdin_eof_triggers_graceful_shutdown(tmp_path):
    """stdin 이 닫히면(EOF) 코어가 스스로 graceful 종료(코드 0)한다.

    Electron 정상 종료 경로(before-quit → stdin.end()). 감시를 os.read 로 바꾼
    뒤에도 EOF 감지가 동작해 깔끔히 종료하는지 보장한다(watcher 본래 목적).
    """
    # 빈 포트 확보(즉시 닫아 코어가 bind 할 수 있게 한다).
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()

    err_path = tmp_path / "core_stderr.txt"
    err_file = open(err_path, "wb")
    proc = None
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "canctl_core", "--mock", "--port", str(port)],
            cwd=str(CORE_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=err_file,
        )
        # 서버가 LISTEN 할 때까지 TCP 접속을 폴링한다.
        deadline = time.time() + 15
        started = False
        while time.time() < deadline:
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
                started = True
                break
            except OSError:
                time.sleep(0.1)
        assert started, "코어 WebSocket 서버가 기동되지 않음"

        # stdin 을 닫아 EOF 전달 → graceful 종료 유도.
        proc.stdin.close()
        try:
            returncode = proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise AssertionError("stdin EOF 후에도 코어가 종료되지 않음(15s)")
    finally:
        err_file.close()
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()

    assert returncode == 0, (
        f"graceful 종료가 코드 0 이 아님(returncode={returncode}). stderr:\n"
        f"{err_path.read_text(encoding='utf-8', errors='replace')}")

