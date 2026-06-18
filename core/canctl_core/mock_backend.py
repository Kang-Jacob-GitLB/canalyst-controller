"""장비 없이 동작하는 mock CAN 백엔드.

연결되면 몇 개의 가상 CAN 메시지를 주기적으로 생성하고,
send() 한 프레임은 echo 하여 RX 스트림에 반영한다(UI 송신 확인용).
"""
from __future__ import annotations

import math
import time
from typing import Callable

from .backend import CanBackend
from .protocol import CanFrame


class _PeriodicSource:
    """일정 주기로 프레임 데이터를 생성하는 가상 메시지 소스."""

    def __init__(self, can_id: int, period: float, gen: Callable[[int], list[int]]):
        self.can_id = can_id
        self.period = period
        self.gen = gen
        self.count = 0
        self.next_at = 0.0

    def due(self, now: float) -> list[tuple[int, list[int]]]:
        """now 시점까지 발생해야 할 (can_id, data) 목록을 반환(catch-up)."""
        out: list[tuple[int, list[int]]] = []
        while now >= self.next_at:
            out.append((self.can_id, self.gen(self.count)))
            self.count += 1
            self.next_at += self.period
        return out


class MockBackend(CanBackend):
    name = "mock"

    def __init__(self) -> None:
        self._connected = False
        self._channel = 0
        self._sources: list[_PeriodicSource] = []
        self._echo: list[CanFrame] = []

    @property
    def connected(self) -> bool:
        return self._connected

    def list_devices(self) -> list[dict]:
        return [{"index": 0, "name": "Mock CANalyst-II", "channels": 2}]

    def connect(self, device_index: int, channel: int, bitrate: int) -> None:
        self._channel = channel
        self._connected = True
        now = time.time()
        # 가상 소스: 카운터(0x100), 사인파(0x200), 하트비트(0x7FF)
        self._sources = [
            _PeriodicSource(0x100, 0.1, lambda c: [c & 0xFF, (c >> 8) & 0xFF]),
            _PeriodicSource(0x200, 0.2,
                            lambda c: [int(math.sin(c / 5.0) * 127 + 128) & 0xFF, 0, 0, 0]),
            _PeriodicSource(0x7FF, 1.0, lambda c: [0xAA, 0x55]),
        ]
        for src in self._sources:
            src.next_at = now + src.period

    def disconnect(self) -> None:
        self._connected = False
        self._sources = []
        self._echo.clear()

    def send(self, channel: int, can_id: int, extended: bool,
             rtr: bool, data: list[int]) -> None:
        if not self._connected:
            raise RuntimeError("연결되지 않았습니다")
        # 송신 프레임을 echo 하여 다음 poll() 의 RX 스트림에 포함
        self._echo.append(CanFrame(
            ts=time.time(), channel=channel, can_id=can_id,
            extended=extended, rtr=rtr, dlc=len(data), data=list(data),
        ))

    def poll(self) -> list[CanFrame]:
        if not self._connected:
            return []
        now = time.time()
        frames: list[CanFrame] = []
        for src in self._sources:
            for can_id, data in src.due(now):
                frames.append(CanFrame(
                    ts=now, channel=self._channel, can_id=can_id,
                    extended=False, rtr=False, dlc=len(data), data=data,
                ))
        if self._echo:
            frames.extend(self._echo)
            self._echo = []
        return frames
