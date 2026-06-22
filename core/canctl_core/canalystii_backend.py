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


def _ensure_usb_backend() -> None:
    """python-can/canalystii 가 libusb_package 번들 libusb-1.0 백엔드를 쓰도록 보장한다.

    Windows 에 시스템 libusb-1.0.dll 이 없을 때 발생하는
    'No backend available'(usb.core.NoBackendError)을 방지한다.
    """
    try:
        import libusb_package
        import usb.backend.libusb1

        backend = libusb_package.get_libusb1_backend()
        if backend is not None:
            usb.backend.libusb1.get_backend = lambda find_library=None: backend
    except Exception as exc:  # libusb_package 미설치 등 — pyusb 기본 탐색에 맡김
        log.debug("libusb 백엔드 주입 실패(기본 탐색 사용): %s", exc)


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
        _ensure_usb_backend()  # Windows libusb 백엔드 보장
        import can  # 지연 import (실장비 미사용 시 로드 부담 제거)

        # CANalyst-II 는 2채널 장비다. 두 채널(0,1)을 모두 init·start 해서
        # 어느 채널로든 송수신할 수 있게 한다. 한 채널만 열면 driver 가
        # init 되지 않은 채널 송신을 RuntimeError("Channel N is not initialized")
        # 로 거부하므로, 연결 채널과 다른 채널로 송신하면 실패한다.
        # (channel 인자는 프로토콜 호환을 위해 받지만 채널 선택에는 쓰지 않는다.
        #  두 채널 모두 connect 의 bitrate 로 초기화된다.)
        self._channel = channel
        self._bus = can.Bus(
            interface="canalystii",
            channel=(0, 1),
            device=device_index,
            bitrate=bitrate,
        )
        log.info("연결됨: device=%d channels=(0,1) bitrate=%d",
                 device_index, bitrate)

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
