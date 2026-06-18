"""asyncio WebSocket 서버.

- 백그라운드 폴링 루프가 backend.poll() 로 프레임을 모아 모든 클라이언트에 rx 배칭 broadcast.
- 클라이언트 명령(list_devices/connect/disconnect/send)을 받아 백엔드에 위임하고 결과를 회신.
"""
from __future__ import annotations

import asyncio
import logging

import websockets

from . import protocol
from .backend import CanBackend
from .dbc import DbcDecoder, DbcUnavailable
from .protocol import ProtocolError
from .recorder import FrameRecorder, read_frames

log = logging.getLogger("canctl_core.server")

#: replay 시 프레임 간 최대 대기(초). 기록 간격이 크더라도 이 값으로 캡.
REPLAY_MAX_GAP = 1.0


class CanServer:
    def __init__(self, backend: CanBackend, host: str = "127.0.0.1",
                 port: int = 8765, poll_interval: float = 0.05) -> None:
        self._backend = backend
        self._host = host
        self._port = port
        self._poll_interval = poll_interval
        self._clients: set = set()
        self._running = False
        # 기능 확장 상태
        self._filter_ids: set[int] = set()     # 전역 수신 필터(빈 set 이면 전체 통과)
        self._recorder = FrameRecorder()        # rx 파일 로깅
        self._decoder = DbcDecoder()            # DBC 신호 디코딩
        self._replay_task: asyncio.Task | None = None  # 진행 중인 replay

    async def run_forever(self) -> None:
        self._running = True
        poll_task = asyncio.create_task(self._broadcast_loop())
        try:
            async with websockets.serve(self._handler, self._host, self._port):
                log.info("WebSocket 서버 시작: ws://%s:%d (backend=%s)",
                         self._host, self._port, self._backend.name)
                await asyncio.Future()  # 영구 대기 (취소될 때까지)
        finally:
            self._running = False
            poll_task.cancel()
            if self._replay_task is not None:
                self._replay_task.cancel()
            self._recorder.stop()  # 열려있던 로그 파일 확실히 닫기

    async def _handler(self, ws) -> None:
        self._clients.add(ws)
        log.info("클라이언트 연결 (총 %d)", len(self._clients))
        try:
            await ws.send(self._status_msg())  # 연결 직후 현재 상태 통지
            async for raw in ws:
                await self._handle_command(ws, raw)
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            log.info("클라이언트 해제 (총 %d)", len(self._clients))

    async def _handle_command(self, ws, raw) -> None:
        try:
            msg = protocol.parse_command(raw)
        except ProtocolError as exc:
            await ws.send(protocol.make_error(str(exc)))
            return

        cmd = msg["type"]
        try:
            if cmd == "list_devices":
                await ws.send(protocol.make_devices(self._backend.list_devices()))
            elif cmd == "connect":
                self._backend.connect(msg["device_index"], msg["channel"], msg["bitrate"])
                await self._broadcast(self._status_msg())
            elif cmd == "disconnect":
                self._backend.disconnect()
                # 진행 중인 로깅·replay 를 정리(끊긴 후 빈 파일이 계속 열려 있지 않게)
                if self._recorder.logging:
                    path = self._recorder.stop()
                    await self._broadcast(protocol.make_log_status(False, path))
                if self._replay_task is not None and not self._replay_task.done():
                    self._replay_task.cancel()
                await self._broadcast(self._status_msg())
            elif cmd == "send":
                self._backend.send(msg["channel"], msg["can_id"],
                                   msg["extended"], msg["rtr"], msg["data"])
            elif cmd == "set_filter":
                self._filter_ids = set(msg["ids"])
                await self._broadcast(protocol.make_filter(sorted(self._filter_ids)))
            elif cmd == "start_log":
                self._recorder.start(msg["path"])
                await self._broadcast(protocol.make_log_status(True, self._recorder.path))
            elif cmd == "stop_log":
                path = self._recorder.stop()
                await self._broadcast(protocol.make_log_status(False, path))
            elif cmd == "replay":
                self._start_replay(msg["path"])
            elif cmd == "load_dbc":
                self._decoder.load(msg["path"])
                log.info("DBC 로드 완료: %s", msg["path"])
        except DbcUnavailable as exc:  # cantools 미설치 등은 안내성 error
            await ws.send(protocol.make_error(str(exc)))
        except Exception as exc:  # 백엔드 오류를 클라이언트로 표면화
            log.exception("명령 처리 오류: %s", cmd)
            await ws.send(protocol.make_error(f"{cmd} 실패: {exc}"))

    def _status_msg(self) -> str:
        return protocol.make_status(
            connected=self._backend.connected,
            backend=self._backend.name,
        )

    async def _broadcast_loop(self) -> None:
        try:
            while self._running:
                frames = self._backend.poll()
                if frames:
                    # 라이브 프레임만 기록(replay 프레임은 재기록하지 않는다)
                    self._recorder.record(frames)
                    passed = self._apply_filter(frames)
                    if passed and self._clients:
                        await self._broadcast(self._rx_msg(passed))
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            pass

    def _apply_filter(self, frames: list) -> list:
        """전역 수신 필터를 적용해 통과 프레임만 반환. 필터가 비면 전체 통과."""
        if not self._filter_ids:
            return frames
        return [f for f in frames if f.can_id in self._filter_ids]

    def _rx_msg(self, frames: list) -> str:
        """필터를 통과한 프레임에 DBC 디코더(로드 시)를 부착한 rx 메시지 생성."""
        return protocol.make_rx(frames, decoder=self._decoder)

    def _start_replay(self, path: str) -> None:
        """기존 replay 가 진행 중이면 취소하고 새 replay task 를 시작."""
        if self._replay_task is not None and not self._replay_task.done():
            self._replay_task.cancel()
        self._replay_task = asyncio.create_task(self._replay_loop(path))

    async def _replay_loop(self, path: str) -> None:
        """기록 파일을 읽어 ts 델타를 재현하며 rx 스트림으로 흘려보낸다(재기록 안 함)."""
        try:
            prev_ts: float | None = None
            for frame in read_frames(path):
                if prev_ts is not None:
                    gap = frame.ts - prev_ts
                    if gap > 0:
                        await asyncio.sleep(min(gap, REPLAY_MAX_GAP))
                prev_ts = frame.ts
                passed = self._apply_filter([frame])
                if passed and self._clients:
                    await self._broadcast(self._rx_msg(passed))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.exception("replay 오류: %s", path)
            await self._broadcast(protocol.make_error(f"replay 실패: {exc}"))

    async def _broadcast(self, msg: str) -> None:
        if not self._clients:
            return
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send(msg)
            except websockets.ConnectionClosed:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)
