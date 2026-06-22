"""canalystii 실장비 백엔드 연결 동작 테스트.

실제 USB 장비 없이 python-can 의 can.Bus 를 모킹해 연결 인자를 검증한다.
회귀 대상: 연결 시 한 채널만 열어서, 연결 채널과 다른 채널로 송신하면
driver 가 RuntimeError("Channel N is not initialized") 를 던져 송신이
실패하던 버그. 두 채널(0,1)을 모두 열어 방지한다.
"""
import can

from canctl_core.canalystii_backend import CanalystIIBackend


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
