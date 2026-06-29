"""python-can(canalystii) 기반 실장비 백엔드.

USB 폴링은 python-can 의 CANalystIIBus.recv(timeout=0) 가 처리하며(한 번 폴링 후 즉시 반환),
poll() 은 그 큐를 비블로킹으로 드레인한다.

주의: canalystii 는 펌웨어/프로토콜 한계로 송신 ACK·버스에러 보고를 지원하지 않는다.

타임스탬프: python-can/canalystii 가 주는 msg.timestamp 는 장비 내부 카운터
(100us 단위를 초로 환산한 값)이지 wall-clock 이 아니다. 반면 송신 프레임은
server 에서 time.time()(epoch)으로 찍힌다. 두 기준이 섞이면 수신 중 송신할 때
TX 시간이 엉뚱하게 표시되므로(첫 프레임 ts 를 t0 로 앵커링하는 UI 기준), poll()
에서 장비 카운터를 epoch 로 정규화해 CanFrame.ts 계약(항상 epoch 초)을 지킨다.
"""
from __future__ import annotations

import logging
import time

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
        # 채널별 (epoch - 장비카운터) 오프셋. 첫 프레임에서 채널마다 한 번 잡는다.
        # 채널이 카운터를 공유하든 독립이든 채널별로 보정하므로 항상 맞는다.
        self._ts_offset: dict[int, float] = {}
        self._device: dict | None = None  # 연결 시 채움(status.device)

    @property
    def connected(self) -> bool:
        return self._bus is not None

    @property
    def device_info(self) -> dict | None:
        return self._device

    @property
    def channels(self) -> list[int] | None:
        # connect 가 항상 두 채널(0,1)을 연다.
        return [0, 1] if self._bus is not None else None

    def list_devices(self) -> list[dict]:
        # python-can/canalystii 는 USB 장치 열거 API를 노출하지 않는다.
        # 첫 장치(index 0, 2채널)를 기본 제공하고, 실제 존재 여부는 connect 시 판명한다.
        return [{"index": 0, "name": "CANalyst-II", "channels": 2}]

    def connect(self, device_index: int, channel: int, bitrate: int,
                bitrate1: int | None = None) -> None:
        if self._bus is not None:
            self.disconnect()
        _ensure_usb_backend()  # Windows libusb 백엔드 보장
        import can  # 지연 import (실장비 미사용 시 로드 부담 제거)
        from canalystii.device import TIMINGS  # 비트레이트→BTR 타이밍 표

        b0 = bitrate
        b1 = bitrate if bitrate1 is None else bitrate1
        # python-can/canalystii 는 TIMINGS 에 등록된 비트레이트만 받는다(임의값 불가).
        # 버스를 만들기 전에 두 채널 값을 모두 검증해 반쪽 열린 상태를 원천 차단한다.
        for b in (b0, b1):
            if b not in TIMINGS:
                raise ValueError(
                    f"지원하지 않는 비트레이트: {b} (지원: {sorted(TIMINGS)})")

        # CANalyst-II 는 2채널 장비다. 두 채널(0,1)을 모두 init·start 해서
        # 어느 채널로든 송수신할 수 있게 한다. 한 채널만 열면 driver 가
        # init 되지 않은 채널 송신을 RuntimeError("Channel N is not initialized")
        # 로 거부하므로, 연결 채널과 다른 채널로 송신하면 실패한다.
        # (channel 인자는 프로토콜 호환을 위해 받지만 채널 선택에는 쓰지 않는다.)
        self._channel = channel
        # 장비/채널 재시작 시 카운터가 0부터 다시 시작하므로 오프셋을 비운다.
        # (첫 프레임에서 재계산)
        self._ts_offset = {}
        # 생성자가 channel=(0,1) 을 모두 b0 로 init·start 한다. bus.channels==[0,1] 이
        # 유지되어야 poll/송신 라우팅이 두 채널을 모두 다루므로, "채널0만 열고 1을 수동
        # init" 하는 식으로 바꾸지 않는다(그러면 채널1 RX/TX 가 조용히 끊긴다).
        bus = can.Bus(
            interface="canalystii",
            channel=(0, 1),
            device=device_index,
            bitrate=b0,
        )
        # 채널1 만 속도가 다르면 재init 으로 덮어쓴다(드라이버 init 은 재호출로 비트레이트
        # 변경 가능, init 후 자동 start). 실패 시 버스를 닫아 반쪽 열린 상태를 남기지 않는다.
        if b1 != b0:
            try:
                bus.device.init(1, bitrate=b1)
            except Exception:
                try:
                    bus.shutdown()
                except Exception:
                    pass
                raise
        self._bus = bus
        self._device = {"index": device_index, "name": "CANalyst-II",
                        "bitrate": b0, "bitrate1": b1}
        log.info("연결됨: device=%d ch0=%d ch1=%d", device_index, b0, b1)

    def disconnect(self) -> None:
        if self._bus is not None:
            try:
                self._bus.shutdown()
            finally:
                self._bus = None
                self._device = None

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
            channel = msg.channel if msg.channel is not None else self._channel
            # 장비 카운터를 epoch 로 정규화한다. 채널마다 첫 프레임에서
            # offset(=현재 epoch - 장비 ts)을 한 번 잡고, 이후엔 그 offset 을
            # 더해 프레임 간 상대 간격은 그대로 보존한다(레이트 계산 정확).
            if channel not in self._ts_offset:
                self._ts_offset[channel] = time.time() - msg.timestamp
            ts = msg.timestamp + self._ts_offset[channel]
            frames.append(CanFrame(
                ts=ts,
                channel=channel,
                can_id=msg.arbitration_id,
                extended=bool(msg.is_extended_id),
                rtr=bool(msg.is_remote_frame),
                dlc=msg.dlc,
                data=list(msg.data),
            ))
            if len(frames) >= _MAX_FRAMES_PER_POLL:
                break
        return frames
