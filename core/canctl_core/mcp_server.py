"""로컬 MCP 서버(`canalyst-core mcp`) — 라이브 세션 어댑터.

플러그인 아키텍처상 책임 경계: **"실행 중 장치/세션이 살아있어야 하면 MCP, 끝난
산출물(캡처 파일)을 다루면 CLI."** 따라서 이 MCP 는 **라이브 동작만** 노출한다:
connect/disconnect, 필터 설정, send(프레임 송신), 주기 송신, 캡처 시작/종료,
실시간 관찰(stream/wait_for), status. **디코드·포맷 변환·통계·export 는 하지 않는다**
(그건 캡처 파일을 받아 CLI 가 한다 — 안 쓸 때도 스키마 토큰을 무는 것을 피하려는 의도).

캡처→분석 핸드오프: `can_stop_capture` 는 저장된 파일의 **절대 경로**를 반환하고 끝낸다.
이후 분석은 그 경로를 CLI 로 넘긴다.

상태 구조(단일 코어 + 얇은 어댑터): 라이브 세션(디바이스 핸들·캡처·필터·주기송신)은
코어 데몬(`server.py`)에 단일 구현되어 있고, 이 MCP 는 그 데몬에 붙는 **얇은 WS
클라이언트**다 — 도메인 상태(집계 등)를 자체 보유하지 않는다. 데몬이 떠 있으면(GUI 실행
중 등) 거기 붙고, 없으면 `canalyst-core` 서버를 **자식 프로세스로 띄워** 세션 동안
소유한다(플러그인 단독 동작). 디바이스 핸들·캡처 세션은 데몬 수명 동안 호출 간 유지된다.

전송: stdio(기본). 단일 클라이언트 가정(상관관계 ID 없음 → 명령 직렬화 + 타입 매칭,
도구를 순차 호출).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from typing import Any, Callable
from urllib.parse import urlparse

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from .aggregator import frame_matches

DEFAULT_URL = "ws://127.0.0.1:8765"


class EngineError(Exception):
    """엔진/데몬 레벨 오류(연결 불가·서버 error·timeout)."""


class CanctlEngine:
    """코어 데몬에 붙는 얇은 영속 WS 클라이언트(라이브 세션 어댑터).

    단일 reader 루프가 모든 수신 메시지를 소비하며:
      - rx        → 진행 중인 stream 수집기에 적재 + wait_for 대기자 해소
      - status    → 최신 상태 보관(can_status)
      - filter    → 최신 서버 필터 보관
      - log_status→ 캡처 상태 보관
      - 그 외     → 진행 중인 request 의 술어/error 로 라우팅(cmd_lock 으로 단일 in-flight)

    데몬이 없으면 `canalyst-core` 서버를 자식으로 spawn 한다(autospawn). 자식 데몬의
    stdin 파이프를 잡고 있어, MCP 프로세스가 죽으면 EOF 로 데몬도 graceful 종료된다.
    """

    def __init__(self, url: str = DEFAULT_URL, timeout: float = 5.0,
                 autospawn: bool = True, mock: bool = False) -> None:
        self.url = url
        self.timeout = timeout
        self._autospawn = autospawn
        self._mock = mock
        self._conn = None
        self._reader: asyncio.Task | None = None
        self._cmd_lock = asyncio.Lock()
        self._connect_lock = asyncio.Lock()
        self._pending: tuple[Callable[[dict], bool], asyncio.Future] | None = None
        self._frame_waiters: list[tuple[Callable[[dict], bool], asyncio.Future]] = []
        self._collectors: list[dict] = []      # stream 수집기들
        self._latest_status: dict | None = None
        self._latest_filter: dict | None = None
        self._latest_log: dict | None = None    # {logging, path}
        self._daemon_proc: subprocess.Popen | None = None

    # --- 연결(+ autospawn) ---

    async def _connect_impl(self):
        """실제 WS 연결(테스트에서 오버라이드해 가짜 연결 주입)."""
        return await asyncio.wait_for(
            websockets.connect(self.url, open_timeout=None), self.timeout)

    def _spawn_daemon(self) -> None:
        """설정 URL 의 host/port 로 코어 데몬을 자식 프로세스로 띄운다.

        stdin=PIPE 를 잡고 있으면, 이 프로세스가 죽을 때 EOF 로 데몬이 graceful 종료된다
        (Electron 사이드카와 동일한 수명 관리).
        """
        u = urlparse(self.url)
        host, port = u.hostname or "127.0.0.1", u.port or 8765
        if getattr(sys, "frozen", False):
            # 동결 바이너리: 인자 없는 멀티콜 = 서버
            cmd = [sys.executable, "--host", host, "--port", str(port)]
        else:
            cmd = [sys.executable, "-m", "canctl_core", "--host", host, "--port", str(port)]
        if self._mock:
            cmd.append("--mock")
        self._daemon_proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def _kill_daemon(self) -> None:
        """spawn 한 자식 데몬을 정리한다(stdin EOF → terminate → reap)."""
        if self._daemon_proc is None:
            return
        try:
            if self._daemon_proc.stdin:
                self._daemon_proc.stdin.close()  # EOF → graceful 종료
            self._daemon_proc.terminate()
            try:
                self._daemon_proc.wait(timeout=2)  # zombie 방지(POSIX)
            except Exception:
                pass
        except Exception:
            pass
        self._daemon_proc = None

    async def _connect_with_retry(self, attempts: int = 50, delay: float = 0.1):
        last: Exception | None = None
        for _ in range(attempts):
            try:
                return await self._connect_impl()
            except (OSError, asyncio.TimeoutError, WebSocketException) as exc:
                last = exc
                await asyncio.sleep(delay)
        raise EngineError(f"데몬을 띄웠으나 연결 실패: {last}")

    async def ensure_connected(self) -> None:
        if self._conn is not None:
            return
        async with self._connect_lock:
            if self._conn is not None:
                return
            try:
                self._conn = await self._connect_impl()
            except (OSError, asyncio.TimeoutError, WebSocketException) as exc:
                if not self._autospawn:
                    raise EngineError(
                        f"코어 데몬에 연결할 수 없습니다({self.url}): {exc}. "
                        f"데몬을 먼저 띄우거나 autospawn 을 켜세요 — `canalyst-core --mock`.")
                self._spawn_daemon()
                try:
                    self._conn = await self._connect_with_retry()
                except EngineError:
                    self._kill_daemon()  # 다음 호출이 데몬을 중복 spawn 하지 않게 정리
                    raise
            self._reader = asyncio.create_task(self._reader_loop())
            # 연결 직후 서버가 보내는 status 를 reader 가 _latest_status 로 소비할 때까지
            # 잠깐 대기한다. 이래야 이 초기 status(이미 연결된 데몬이면 connected=true·옛
            # bitrate)가 이후 request(예: can_connect 의 connected=true 술어)에 '낡은' 응답
            # 으로 매칭되는 레이스를 막는다(CLI h_connect 의 드레인과 동일한 가드).
            for _ in range(max(1, int(self.timeout / 0.02))):
                if self._latest_status is not None:
                    break
                await asyncio.sleep(0.02)

    async def _reader_loop(self) -> None:
        try:
            async for raw in self._conn:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                mtype = msg.get("type")
                if mtype == "rx":
                    frames = msg.get("frames", [])
                    if self._frame_waiters:
                        self._resolve_frame_waiters(frames)
                    if self._collectors:
                        self._feed_collectors(frames)
                elif mtype == "status":
                    self._latest_status = msg
                elif mtype == "filter":
                    self._latest_filter = {
                        "ids": msg.get("ids", []), "mask": msg.get("mask"),
                        "channel": msg.get("channel"),
                    }
                elif mtype == "log_status":
                    self._latest_log = {"logging": msg.get("logging"),
                                        "path": msg.get("path")}
                # request 응답 라우팅. error 는 상관관계 ID 가 없어 진행 중 request 의 것으로
                # 간주한다 — cmd_lock 직렬화 + 도구 순차 호출(단일 클라이언트 가정)이 전제다.
                pending = self._pending
                if pending is not None and not pending[1].done():
                    pred, fut = pending
                    if mtype == "error":
                        fut.set_exception(EngineError(msg.get("message", "서버 오류")))
                    elif pred(msg):
                        fut.set_result(msg)
        except (ConnectionClosed, OSError):
            pass
        finally:
            self._conn = None
            if self._pending is not None and not self._pending[1].done():
                self._pending[1].set_exception(EngineError("데몬 연결이 끊겼습니다"))
            for _, fut in self._frame_waiters:
                if not fut.done():
                    fut.set_exception(EngineError("데몬 연결이 끊겼습니다"))
            self._frame_waiters.clear()

    def _resolve_frame_waiters(self, frames: list[dict]) -> None:
        for fr in frames:
            for entry in list(self._frame_waiters):
                pred, fut = entry
                if not fut.done() and pred(fr):
                    fut.set_result(fr)
                    self._frame_waiters.remove(entry)

    def _feed_collectors(self, frames: list[dict]) -> None:
        for col in self._collectors:
            for fr in frames:
                if col["ids"] is not None and fr["can_id"] not in col["ids"]:
                    continue
                if col["channel"] is not None and fr["channel"] != col["channel"]:
                    continue
                col["frames"].append(fr)

    # --- 요청/대기/관찰 ---

    async def request(self, command: dict, predicate: Callable[[dict], bool],
                      timeout: float | None = None) -> dict:
        await self.ensure_connected()
        timeout = timeout or self.timeout
        async with self._cmd_lock:
            loop = asyncio.get_running_loop()
            fut: asyncio.Future = loop.create_future()
            self._pending = (predicate, fut)
            try:
                await self._conn.send(json.dumps(command))
                return await asyncio.wait_for(fut, timeout)
            except asyncio.TimeoutError:
                raise EngineError(f"'{command.get('type')}' 응답 시간 초과({timeout}s)")
            finally:
                self._pending = None

    async def wait_for(self, predicate: Callable[[dict], bool],
                       timeout: float) -> dict | None:
        """술어에 맞는 라이브 프레임이 올 때까지 대기. timeout 시 None."""
        await self.ensure_connected()
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        entry = (predicate, fut)
        self._frame_waiters.append(entry)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            if entry in self._frame_waiters:
                self._frame_waiters.remove(entry)

    async def stream(self, duration: float, count: int | None,
                     ids: list[int] | None, channel: int | None) -> list[dict]:
        """duration 초 동안(또는 count 개까지) 라이브 rx 프레임을 모아 반환(유한·비차단)."""
        await self.ensure_connected()
        col = {"frames": [], "ids": set(ids) if ids else None, "channel": channel}
        self._collectors.append(col)
        try:
            loop = asyncio.get_running_loop()
            deadline = loop.time() + duration
            while True:
                if count is not None and len(col["frames"]) >= count:
                    break
                if loop.time() >= deadline:
                    break
                await asyncio.sleep(min(0.05, max(0.0, deadline - loop.time())))
        finally:
            self._collectors.remove(col)
        frames = col["frames"]
        return frames[:count] if count is not None else frames

    # --- 상태 ---

    async def status(self) -> dict:
        await self.ensure_connected()
        for _ in range(max(1, int(self.timeout / 0.02))):
            if self._latest_status is not None:
                break
            await asyncio.sleep(0.02)
        out = dict(self._latest_status) if self._latest_status else {
            "type": "status", "connected": False}
        out["ws_connected"] = self._conn is not None
        out["server_filter"] = self._latest_filter
        out["capturing"] = bool(self._latest_log and self._latest_log.get("logging"))
        out["capture_path"] = self._latest_log.get("path") if self._latest_log else None
        return out

    async def aclose(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
        if self._conn is not None:
            try:
                await self._conn.close()
            except Exception:
                pass
            self._conn = None
        self._kill_daemon()


INSTRUCTIONS = (
    "CANalyst-II(USB-CAN 분석기) 라이브 제어 도구. 자작 도구이므로 아래 설명에만 의존하라. "
    "흐름: can_connect 로 장치 연결 → can_send 로 송신(주의: 실제 버스 송신은 되돌릴 수 없음) "
    "/ can_start_capture 로 기록 시작 → can_stop_capture 로 끝내면 저장 파일의 절대경로를 "
    "돌려준다(그 파일의 디코드·통계·변환은 이 도구가 아니라 CLI 분석 단계의 몫). 짧은 라이브 "
    "확인은 can_stream(유한 수집)·can_wait_for(조건 프레임 대기). can_id 는 정수다(0x123 == 291). "
    "한 번에 한 도구씩 순차 호출하라(단일 클라이언트 가정). 데몬은 없으면 자동 기동된다."
)


def build_app(engine: CanctlEngine):
    """FastMCP 앱 구성(mcp SDK 는 여기서 지연 import). 라이브 툴만 노출."""
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise SystemExit(
            "MCP 모드에는 mcp SDK 가 필요합니다 — `pip install -e .[mcp]` 후 다시 실행하세요. "
            f"(원인: {exc})")

    app = FastMCP("canalyst-core", instructions=INSTRUCTIONS)

    @app.tool()
    async def can_status() -> dict:
        """현재 라이브 세션 상태를 반환한다.

        반환: ws_connected(데몬 연결), connected(장치 연결), backend, device(index/name/
        bitrate=채널0/bitrate1=채널1), channels, server_filter(현재 수신 필터 또는 null),
        capturing(캡처 중 여부), capture_path(기록 중인 파일 경로 또는 null).
        """
        return await engine.status()

    @app.tool()
    async def can_connect(device_index: int = 0, bitrate: int = 500000,
                          bitrate1: int | None = None, channel: int = 0) -> dict:
        """CAN 장치를 연다(2채널 장비; 채널0·채널1 을 독립 비트레이트로 열 수 있다). 호출 간 연결 유지.

        bitrate: 채널0 비트레이트(정수 bps, 예 500000). bitrate1: 채널1 비트레이트 —
        생략하면 bitrate 와 같아 두 채널을 같은 속도로 연다. 다른 속도로 채널을 분리하려면
        bitrate1 을 지정하라(예 bitrate=500000, bitrate1=250000). 둘 다 드라이버 지원
        표준값이어야 한다(10000/20000/50000/100000/125000/250000/500000/800000/1000000 등).
        비트레이트를 바꾸려면 다른 값으로 다시 호출(재연결). device_index: can_status/장치
        목록의 인덱스(보통 0). channel: 프로토콜 호환용(채널 선택엔 미사용).
        반환: 연결 후 status(device.bitrate=채널0, device.bitrate1=채널1).
        """
        payload: dict[str, Any] = {
            "type": "connect", "device_index": device_index,
            "channel": channel, "bitrate": bitrate}
        if bitrate1 is not None:
            payload["bitrate1"] = bitrate1
        return await engine.request(
            payload,
            lambda m: m.get("type") == "status" and m.get("connected") is True)

    @app.tool()
    async def can_disconnect() -> dict:
        """CAN 장치 연결을 해제한다(진행 중 캡처·주기송신도 데몬이 정리). 반환: status."""
        return await engine.request(
            {"type": "disconnect"},
            lambda m: m.get("type") == "status" and m.get("connected") is False)

    @app.tool()
    async def can_set_filter(ids: list[int] | None = None, mask: int | None = None,
                             channel: int | None = None) -> dict:
        """라이브 수신 필터를 설정한다(필터 전체 교체).

        ids: 통과시킬 CAN ID(정수) 목록. **빈 목록/생략 = 전체 통과.** mask: ID 마스크
        (생략 시 정확 일치). channel: 특정 채널만(생략 시 전체). 주의: 데몬 전역 상태라
        같은 데몬에 붙은 다른 클라이언트(GUI 등) 수신에도 영향을 준다. 반환: 적용된 필터.
        """
        payload: dict[str, Any] = {"type": "set_filter", "ids": list(ids or [])}
        if mask is not None:
            payload["mask"] = mask
        if channel is not None:
            payload["channel"] = channel
        return await engine.request(payload, lambda m: m.get("type") == "filter")

    @app.tool()
    async def can_send(can_id: int, data: list[int] | None = None, channel: int = 0,
                       extended: bool = False, rtr: bool = False,
                       dry_run: bool = False) -> dict:
        """⚠️ CAN 프레임을 **실제 버스로 1회 송신**한다 — 되돌릴 수 없는 위험 동작.

        실차/실장비에 영향을 줄 수 있으니, 확신이 없으면 먼저 dry_run=True 로 보낼 프레임을
        확인한 뒤 사용자에게 알리고 보내라.
        can_id: 정수(0x123 == 291). data: 0..8개 바이트(각 0..255). extended: 29비트 ID.
        rtr: 원격 프레임. dry_run=True 면 **송신하지 않고** 보낼 프레임만 돌려준다.
        반환: 실제 송신 시 {sent:true, frame}, dry_run 시 {sent:false, dry_run:true, frame}.
        """
        frame = {"channel": channel, "can_id": can_id, "extended": extended,
                 "rtr": rtr, "data": list(data or []), "dlc": len(data or [])}
        if dry_run:
            return {"sent": False, "dry_run": True, "frame": frame}
        payload = {"type": "send", **{k: frame[k] for k in
                   ("channel", "can_id", "extended", "rtr", "data")}}
        msg = await engine.request(
            payload, lambda m: m.get("type") == "rx" and any(
                f.get("dir") == "tx" and f.get("can_id") == can_id
                for f in m.get("frames", [])))
        tx = next(f for f in msg["frames"]
                  if f.get("dir") == "tx" and f.get("can_id") == can_id)
        return {"sent": True, "frame": tx}

    @app.tool()
    async def can_send_periodic(can_id: int, period: float,
                                data: list[int] | None = None,
                                count: int | None = None, channel: int = 0,
                                extended: bool = False, rtr: bool = False) -> dict:
        """⚠️ 프레임을 **주기적으로 버스에 송신**하기 시작한다(되돌릴 수 없는 라이브 송신).

        period: 송신 간격(초, 0 초과). count: 총 송신 횟수(생략 시 무한). 나머지는 can_send 와
        동일. 세션 상태로 유지되며 can_stop_periodic 또는 disconnect 로 멈춘다.
        반환: 진행 중인 주기 송신 목록(각 항목에 발급된 id 포함).
        """
        payload = {"type": "send_periodic", "channel": channel, "can_id": can_id,
                   "extended": extended, "rtr": rtr, "data": list(data or []),
                   "period": period}
        if count is not None:
            payload["count"] = count
        return await engine.request(
            payload, lambda m: m.get("type") == "periodic_status")

    @app.tool()
    async def can_stop_periodic(id: int | None = None) -> dict:
        """주기 송신을 멈춘다. id 지정 시 해당 태스크만, 생략 시 전체. 반환: 남은 목록."""
        payload: dict[str, Any] = {"type": "stop_periodic"}
        if id is not None:
            payload["id"] = id
        return await engine.request(
            payload, lambda m: m.get("type") == "periodic_status")

    @app.tool()
    async def can_start_capture(path: str | None = None) -> dict:
        """수신 프레임을 파일로 **기록 시작**한다. 분석은 하지 않고 원시 기록만 한다.

        기록 포맷은 **JSONL**(한 줄=한 프레임)이며 확장자와 무관하다(.blf 등 다른 확장자를
        줘도 내용은 JSONL). path 생략 시 현재 디렉터리에 타임스탬프 이름으로 생성한다.
        반환: {capturing:true, path(절대경로)}. (디코드·통계·변환은 캡처 종료 후 그 파일을
        CLI 로 분석하라.)
        """
        if not path:
            path = f"canalyst_capture_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
        abspath = os.path.abspath(path)
        await engine.request(
            {"type": "start_log", "path": abspath},
            lambda m: m.get("type") == "log_status" and m.get("logging") is True)
        return {"capturing": True, "path": abspath}

    @app.tool()
    async def can_stop_capture() -> dict:
        """캡처를 **종료**하고 저장된 파일의 **절대 경로**를 반환한다(분석 핸드오프 지점).

        반환: {path(절대경로), bytes(파일 크기)}. 이 경로를 이후 CLI 분석(디코드/통계/변환/
        export)으로 넘겨라 — 이 도구는 파일을 열거나 분석하지 않는다(경로·크기 메타데이터만,
        대용량 캡처에서도 O(1)). bytes 는 "뭔가 기록됐는지" 확인용.
        """
        msg = await engine.request(
            {"type": "stop_log"},
            lambda m: m.get("type") == "log_status" and m.get("logging") is False)
        path = msg.get("path")
        abspath = os.path.abspath(path) if path else None
        size = None
        if abspath and os.path.exists(abspath):
            try:
                size = os.path.getsize(abspath)  # 메타데이터만 — 파일 내용은 읽지 않음
            except OSError:
                size = None
        return {"path": abspath, "bytes": size}

    @app.tool()
    async def can_stream(duration: float = 2.0, count: int | None = None,
                         ids: list[int] | None = None,
                         channel: int | None = None) -> dict:
        """라이브 수신 프레임을 **유한 시간 동안** 모아 그대로 반환한다(빠른 현장 확인용).

        절대 무한 대기하지 않는다: duration(초, 기본 2)이 하드 상한이고, count 지정 시 그
        개수에 도달하면 조기 종료. ids/channel 로 클라이언트 측 필터. 통계가 아니라 원시
        프레임 목록을 준다 — 대량/지속 분석은 can_start_capture 후 CLI 로 하라.
        반환: {count, frames:[{ts,channel,can_id,extended,rtr,dlc,data,dir}, ...]}.
        """
        frames = await engine.stream(duration=duration, count=count,
                                     ids=ids, channel=channel)
        return {"count": len(frames), "frames": frames}

    @app.tool()
    async def can_wait_for(can_id: int | None = None, channel: int | None = None,
                           data_prefix: list[int] | None = None,
                           timeout: float = 5.0) -> dict:
        """조건에 맞는 라이브 프레임이 올 때까지(최대 timeout 초) 대기 후 반환(이벤트 트리거).

        대기 중 토큰 소모는 사실상 0, 결과는 1건만. 조건(미지정은 무시): can_id(정수),
        channel, data_prefix(데이터 앞부분 바이트 일치). 반환: 맞는 프레임 {frame} 또는
        시간 초과 시 {timed_out:true, timeout}.
        """
        pred = lambda fr: frame_matches(  # noqa: E731
            fr, can_id=can_id, channel=channel, dir="rx", data_prefix=data_prefix)
        fr = await engine.wait_for(pred, timeout)
        return {"timed_out": True, "timeout": timeout} if fr is None else {"frame": fr}

    return app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="canalyst-core mcp",
        description="CANalyst-II 라이브 제어 MCP 서버(stdio). 코어 데몬에 위임.",
    )
    parser.add_argument("--url", default=os.environ.get("CANCTL_URL", DEFAULT_URL),
                        help=f"코어 데몬 WS 주소(기본 {DEFAULT_URL})")
    parser.add_argument("--timeout", type=float, default=5.0,
                        help="명령 응답 대기 상한(초)")
    parser.add_argument("--mock", action="store_true",
                        help="자동 기동하는 데몬을 mock 으로(장비 불필요, 테스트용)")
    parser.add_argument("--no-autospawn", action="store_true",
                        help="데몬 자동 기동 비활성화(외부 데몬 필수)")
    args = parser.parse_args(argv)

    engine = CanctlEngine(args.url, args.timeout,
                          autospawn=not args.no_autospawn, mock=args.mock)
    app = build_app(engine)
    app.run("stdio")


if __name__ == "__main__":
    main()
