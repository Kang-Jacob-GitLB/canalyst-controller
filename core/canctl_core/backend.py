"""CAN 백엔드 추상 인터페이스.

mock 과 실장비(canalystii) 구현이 이 인터페이스를 따른다.
poll() 은 반드시 **비블로킹**이어야 한다(그동안 쌓인 프레임만 반환).
실장비 구현은 내부 스레드에서 수신해 큐에 쌓고, poll() 은 큐를 비운다.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from .protocol import CanFrame


class CanBackend(ABC):
    #: 백엔드 식별 이름(status 메시지에 노출)
    name: str = "base"

    @property
    @abstractmethod
    def connected(self) -> bool:
        ...

    @abstractmethod
    def list_devices(self) -> list[dict]:
        """연결 가능한 장치 목록. 각 항목: {index, name, channels}."""

    @abstractmethod
    def connect(self, device_index: int, channel: int, bitrate: int) -> None:
        ...

    @abstractmethod
    def disconnect(self) -> None:
        ...

    @abstractmethod
    def send(self, channel: int, can_id: int, extended: bool,
             rtr: bool, data: list[int]) -> None:
        ...

    @abstractmethod
    def poll(self) -> list[CanFrame]:
        """그동안 수신/생성된 프레임을 비블로킹으로 반환(없으면 빈 리스트)."""
