"""python-can(canalystii) 기반 실장비 백엔드.

USB 폴링은 python-can 의 CANalystIIBus.recv(timeout=0) 가 처리하며(한 번 폴링 후 즉시 반환),
poll() 은 그 큐를 비블로킹으로 드레인한다.

주의: canalystii 는 펌웨어/프로토콜 한계로 송신 ACK·버스에러 보고를 지원하지 않는다.
"""
from __future__ import annotations

import logging

from .backend import CanBackend
from .protocol import CanFrame

log = logging.getLogger("canctl_core.canalystii")

# UI 드롭다운과 일치시킬 표준 비트레이트(드라이버는 임의값도 받지만 표준값 권장)
SUPPORTED_BITRATES = [10000, 20000, 50000, 100000, 125000,
                      250000, 500000, 800000, 1000000]

# 한 번의 poll() 에서 가져올 최대 프레임 수(이벤트 루프 점유 방지 안전 상한)
_MAX_FRAMES_PER_POLL = 5000


class CanalystIIBackend(CanBackend):
    name = "canalystii"

    def __init__(self) -> None:
        self._bus = None
        self._channel = 0

    @property
    def connected(self) -> bool:
        return self._bus is not None

    def list_devices(self) -> list[dict]:
        # python-can/canalystii 는 USB 장치 열거 API를 노출하지 않는다.
        # 첫 장치(index 0, 2채널)를 기본 제공하고, 실제 존재 여부는 connect 시 판명한다.
        return [{"index": 0, "name": "CANalyst-II", "channels": 2}]

    def connect(self, device_index: int, channel: int, bitrate: int) -> None:
        if self._bus is not None:
            self.disconnect()
        import can  # 지연 import (실장비 미사용 시 로드 부담 제거)

        self._channel = channel
        self._bus = can.Bus(
            interface="canalystii",
            channel=channel,
            device=device_index,
            bitrate=bitrate,
        )
        log.info("연결됨: device=%d channel=%d bitrate=%d",
                 device_index, channel, bitrate)

    def disconnect(self) -> None:
        if self._bus is not None:
            try:
                self._bus.shutdown()
            finally:
                self._bus = None

    def send(self, channel: int, can_id: int, extended: bool,
             rtr: bool, data: list[int]) -> None:
        if self._bus is None:
            raise RuntimeError("연결되지 않았습니다")
        import can

        msg = can.Message(
            arbitration_id=can_id,
            is_extended_id=extended,
            is_remote_frame=rtr,
            dlc=len(data),
            data=bytes(data),
            channel=channel,
        )
        self._bus.send(msg)

    def poll(self) -> list[CanFrame]:
        bus = self._bus
        if bus is None:
            return []
        frames: list[CanFrame] = []
        while True:
            msg = bus.recv(timeout=0)
            if msg is None:
                break
            frames.append(CanFrame(
                ts=msg.timestamp,
                channel=msg.channel if msg.channel is not None else self._channel,
                can_id=msg.arbitration_id,
                extended=bool(msg.is_extended_id),
                rtr=bool(msg.is_remote_frame),
                dlc=msg.dlc,
                data=list(msg.data),
            ))
            if len(frames) >= _MAX_FRAMES_PER_POLL:
                break
        return frames
