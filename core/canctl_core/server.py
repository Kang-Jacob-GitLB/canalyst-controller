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
from .protocol import ProtocolError

log = logging.getLogger("canctl_core.server")


class CanServer:
    def __init__(self, backend: CanBackend, host: str = "127.0.0.1",
                 port: int = 8765, poll_interval: float = 0.05) -> None:
        self._backend = backend
        self._host = host
        self._port = port
        self._poll_interval = poll_interval
        self._clients: set = set()
        self._running = False

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
                await self._broadcast(self._status_msg())
            elif cmd == "send":
                self._backend.send(msg["channel"], msg["can_id"],
                                   msg["extended"], msg["rtr"], msg["data"])
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
                if frames and self._clients:
                    await self._broadcast(protocol.make_rx(frames))
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            pass

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
