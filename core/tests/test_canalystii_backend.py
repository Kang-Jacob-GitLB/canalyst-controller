"""canalystii 실장비 백엔드 연결 동작 테스트.

실제 USB 장비 없이 python-can 의 can.Bus 를 모킹해 연결 인자를 검증한다.
회귀 대상: 연결 시 한 채널만 열어서, 연결 채널과 다른 채널로 송신하면
driver 가 RuntimeError("Channel N is not initialized") 를 던져 송신이
실패하던 버그. 두 채널(0,1)을 모두 열어 방지한다.

또한 poll() 의 타임스탬프 정규화도 검증한다. python-can/canalystii 의
msg.timestamp 는 장비 내부 카운터(epoch 아님)라, 그대로 쓰면 epoch 로 찍히는
송신 프레임과 기준이 달라 수신 중 송신 시 TX 시간이 폭발한다. poll() 이
장비 카운터를 epoch 로 정규화하는지 확인한다.
"""
import time

import can

from canctl_core.canalystii_backend import CanalystIIBackend


class _FakeBus:
    """미리 넣어둔 메시지를 recv 로 하나씩 돌려주는 가짜 bus(poll 테스트용)."""

    def __init__(self, messages):
        self._messages = list(messages)

    def recv(self, timeout=0):
        if self._messages:
            return self._messages.pop(0)
        return None

    def shutdown(self):
        pass


def _msg(timestamp, channel, can_id=0x100):
    return can.Message(
        timestamp=timestamp,
        channel=channel,
        arbitration_id=can_id,
        is_extended_id=False,
        is_remote_frame=False,
        dlc=1,
        data=bytes([0x11]),
    )


def test_connect_opens_both_channels(monkeypatch):
    """연결 시 두 채널(0,1)을 모두 열어야 어느 채널로든 송신할 수 있다.

    수정 전에는 can.Bus(channel=<단일 채널>) 로 한 채널만 init 됐다.
    """
    captured = {}

    class FakeBus:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def shutdown(self):
            pass

    monkeypatch.setattr(can, "Bus", FakeBus)

    backend = CanalystIIBackend()
    # 연결 채널로 1을 넘겨도, 백엔드는 두 채널을 모두 연다.
    backend.connect(device_index=0, channel=1, bitrate=500000)

    assert captured["channel"] == (0, 1)  # 단일 int 가 아니라 두 채널 튜플
    assert captured["interface"] == "canalystii"
    assert captured["device"] == 0
    assert captured["bitrate"] == 500000
    assert backend.connected


def test_poll_normalizes_device_ts_to_epoch():
    """장비 카운터 ts 를 epoch 로 정규화하되 프레임 간 간격은 보존한다.

    회귀 대상: poll() 이 msg.timestamp(장비 카운터)를 그대로 ts 로 쓰면
    epoch 로 찍히는 TX 와 기준이 달라 수신 중 송신 시 TX 시간이 폭발한다.
    """
    backend = CanalystIIBackend()
    # 장비 카운터는 작은 값(예: 100초대)에서 0.001초 간격으로 들어온다.
    backend._bus = _FakeBus([_msg(100.000, channel=0), _msg(100.001, channel=0)])

    before = time.time()
    frames = backend.poll()
    after = time.time()

    assert len(frames) == 2
    # ① 정규화된 ts 는 wall-clock epoch 근처여야 한다(장비 카운터 100.x 가 아님).
    assert before <= frames[0].ts <= after + 1
    # ② 프레임 간 간격(0.001초)은 그대로 보존돼야 한다(레이트 계산 정확성).
    assert abs((frames[1].ts - frames[0].ts) - 0.001) < 1e-6


def test_poll_offset_is_per_channel():
    """채널마다 카운터 base 가 달라도 각 채널을 독립적으로 epoch 로 정규화한다."""
    backend = CanalystIIBackend()
    # 채널 0 은 100초대, 채널 1 은 5000초대 카운터라고 가정.
    backend._bus = _FakeBus([_msg(100.0, channel=0), _msg(5000.0, channel=1)])

    before = time.time()
    frames = backend.poll()
    after = time.time()

    # 두 채널 모두 epoch 근처로 정규화돼야 한다(채널 1 이 +4900초 튀지 않음).
    assert before <= frames[0].ts <= after + 1
    assert before <= frames[1].ts <= after + 1


def test_connect_resets_ts_offset(monkeypatch):
    """재연결 시 장비 카운터가 0부터 다시 시작하므로 offset 을 비워야 한다."""
    class FakeBus:
        def __init__(self, **kwargs):
            pass

        def shutdown(self):
            pass

    monkeypatch.setattr(can, "Bus", FakeBus)

    backend = CanalystIIBackend()
    backend._ts_offset = {0: 12345.0}  # 이전 연결의 잔여 offset
    backend.connect(device_index=0, channel=0, bitrate=500000)

    assert backend._ts_offset == {}  # 연결 시 비워져 첫 프레임에서 재계산
