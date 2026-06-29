import pytest

import canctl_core.mock_backend as mb
from canctl_core.mock_backend import MockBackend, _PeriodicSource


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def time(self):
        return self.t


def test_periodic_source_catchup():
    src = _PeriodicSource(0x100, 0.1, lambda c: [c & 0xFF])
    src.next_at = 1000.1  # connect 시점에 설정되는 값 모방
    out = src.due(1000.25)  # 1000.1, 1000.2 두 번 발생(1000.3은 아직)
    assert len(out) == 2
    assert out[0] == (0x100, [0])
    assert out[1] == (0x100, [1])


def test_poll_empty_before_connect():
    assert MockBackend().poll() == []


def test_connect_generates_frames(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(mb.time, "time", clock.time)
    backend = MockBackend()
    backend.connect(0, 0, 500000)
    assert backend.connected
    clock.t += 0.35  # 0x100(0.1) 3회 + 0x200(0.2) 1회
    frames = backend.poll()
    ids = {f.can_id for f in frames}
    assert 0x100 in ids
    assert len(frames) >= 3


def test_send_does_not_echo(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(mb.time, "time", clock.time)
    backend = MockBackend()
    backend.connect(0, 0, 500000)
    backend.send(0, 0x123, False, False, [1, 2, 3])
    # mock 은 더 이상 echo 하지 않는다(TX 표시는 서버가 tx 로 담당)
    assert all(f.can_id != 0x123 for f in backend.poll())


def test_disconnect_clears(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(mb.time, "time", clock.time)
    backend = MockBackend()
    backend.connect(0, 0, 500000)
    backend.disconnect()
    assert not backend.connected
    clock.t += 1.0
    assert backend.poll() == []


def test_send_when_disconnected_raises():
    with pytest.raises(RuntimeError):
        MockBackend().send(0, 0x1, False, False, [])


def test_connect_per_channel_bitrate():
    backend = MockBackend()
    backend.connect(0, 0, 500000, 250000)
    assert backend.device_info["bitrate"] == 500000
    assert backend.device_info["bitrate1"] == 250000


def test_connect_bitrate1_defaults_to_bitrate():
    backend = MockBackend()
    backend.connect(0, 0, 500000)  # bitrate1 생략 → 채널1 도 채널0 과 동일
    assert backend.device_info["bitrate"] == 500000
    assert backend.device_info["bitrate1"] == 500000
