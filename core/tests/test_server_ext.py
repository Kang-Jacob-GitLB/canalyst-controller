"""CanServer 기능 확장(필터/로깅/replay/DBC 부착) 테스트.

pytest-asyncio 미설치 환경이므로 비동기 코루틴은 asyncio.run 으로 구동한다.
실제 WebSocket 서버는 띄우지 않고, 가짜 ws/백엔드로 메서드를 직접 호출한다.
"""
import asyncio
import json

import pytest

from canctl_core.backend import CanBackend
from canctl_core.protocol import CanFrame
from canctl_core.recorder import read_frames
from canctl_core.server import CanServer


class FakeWs:
    """send 된 메시지를 수집하는 가짜 WebSocket."""

    def __init__(self):
        self.sent = []

    async def send(self, msg):
        self.sent.append(json.loads(msg))


class FakeBackend(CanBackend):
    name = "fake"

    def __init__(self):
        self._connected = False
        self._queue = []

    @property
    def connected(self):
        return self._connected

    def list_devices(self):
        return [{"index": 0, "name": "Fake", "channels": 1}]

    def connect(self, device_index, channel, bitrate):
        self._connected = True

    def disconnect(self):
        self._connected = False

    def send(self, channel, can_id, extended, rtr, data):
        pass

    def poll(self):
        out, self._queue = self._queue, []
        return out


def _frames():
    return [
        CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2]),
        CanFrame(1.0, 0, 0x200, False, False, 1, [9]),
        CanFrame(1.0, 0, 0x7FF, False, False, 2, [0xAA, 0x55]),
    ]


# --- _apply_filter 순수 테스트 ---

def test_apply_filter_empty_passes_all():
    srv = CanServer(FakeBackend())
    frames = _frames()
    assert srv._apply_filter(frames) == frames  # 빈 필터 = 전체 통과


def test_apply_filter_allows_only_listed():
    srv = CanServer(FakeBackend())
    srv._filter_ids = {0x100, 0x7FF}
    passed = srv._apply_filter(_frames())
    ids = [f.can_id for f in passed]
    assert ids == [0x100, 0x7FF]


def test_apply_filter_all_blocked():
    srv = CanServer(FakeBackend())
    srv._filter_ids = {0x999}
    assert srv._apply_filter(_frames()) == []


# --- _apply_filter: 마스크/채널 확장 ---

def _multi_channel_frames():
    """채널이 섞인 프레임(채널 필터 검증용)."""
    return [
        CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2]),
        CanFrame(1.0, 0, 0x101, False, False, 1, [9]),
        CanFrame(1.0, 1, 0x200, False, False, 2, [0xAA, 0x55]),
        CanFrame(1.0, 1, 0x7FF, False, False, 0, []),
    ]


def test_apply_filter_mask_range_match():
    # mask=0x700 으로 0x100/0x101 을 같은 그룹(0x100)으로 매칭
    srv = CanServer(FakeBackend())
    srv._filter_ids = {0x100}
    srv._filter_mask = 0x700
    passed = srv._apply_filter(_multi_channel_frames())
    assert [f.can_id for f in passed] == [0x100, 0x101]


def test_apply_filter_mask_zero_matches_all_ids():
    # mask=0 이면 (id & 0) == 0 이므로 모든 id 가 매칭(예외 없음)
    srv = CanServer(FakeBackend())
    srv._filter_ids = {0x999}  # 존재하지 않는 id 라도
    srv._filter_mask = 0
    passed = srv._apply_filter(_multi_channel_frames())
    assert len(passed) == 4  # 전부 통과


def test_apply_filter_channel_only():
    # ids 비어있으면 id 전체 통과, channel=1 인 것만
    srv = CanServer(FakeBackend())
    srv._filter_channel = 1
    passed = srv._apply_filter(_multi_channel_frames())
    assert [f.can_id for f in passed] == [0x200, 0x7FF]


def test_apply_filter_channel_zero():
    # channel=0 은 유효값(falsy 아님) — 채널 0 만 통과
    srv = CanServer(FakeBackend())
    srv._filter_channel = 0
    passed = srv._apply_filter(_multi_channel_frames())
    assert [f.can_id for f in passed] == [0x100, 0x101]


def test_apply_filter_channel_and_ids():
    # channel 과 id 는 AND
    srv = CanServer(FakeBackend())
    srv._filter_ids = {0x100, 0x200}
    srv._filter_channel = 1
    passed = srv._apply_filter(_multi_channel_frames())
    assert [f.can_id for f in passed] == [0x200]


def test_apply_filter_defaults_none():
    # __init__ 기본값: mask/channel None, ids 빈 set → 전체 통과
    srv = CanServer(FakeBackend())
    assert srv._filter_mask is None
    assert srv._filter_channel is None
    frames = _multi_channel_frames()
    assert srv._apply_filter(frames) == frames


# --- 명령 핸들러: set_filter ---

def test_handle_set_filter_updates_state_and_broadcasts():
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)  # filter 이벤트를 받기 위해 클라이언트 등록
    asyncio.run(srv._handle_command(ws, '{"type":"set_filter","ids":[2047,256]}'))
    assert srv._filter_ids == {256, 2047}
    filt = [m for m in ws.sent if m["type"] == "filter"]
    assert len(filt) == 1
    assert filt[0]["ids"] == [256, 2047]  # 정렬되어 통지
    # mask/channel 미지정 시 기본값으로 통지(all-ones / null)
    assert filt[0]["mask"] == 0xFFFFFFFF
    assert filt[0]["channel"] is None


def test_handle_set_filter_with_mask_and_channel():
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)
    asyncio.run(srv._handle_command(
        ws, '{"type":"set_filter","ids":[256],"mask":1792,"channel":0}'))
    assert srv._filter_ids == {256}
    assert srv._filter_mask == 1792
    assert srv._filter_channel == 0  # channel=0 유효
    filt = [m for m in ws.sent if m["type"] == "filter"][0]
    assert filt["mask"] == 1792
    assert filt["channel"] == 0


def test_handle_set_filter_replaces_previous_mask_channel():
    # set_filter 는 필터 전체를 교체: mask/channel 미지정 시 기본값으로 재설정
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)
    asyncio.run(srv._handle_command(
        ws, '{"type":"set_filter","ids":[256],"mask":1792,"channel":1}'))
    assert srv._filter_mask == 1792 and srv._filter_channel == 1
    # 다음 set_filter 가 mask/channel 없이 오면 기본값으로 되돌아간다
    asyncio.run(srv._handle_command(ws, '{"type":"set_filter","ids":[512]}'))
    assert srv._filter_ids == {512}
    assert srv._filter_mask is None
    assert srv._filter_channel is None


# --- 명령 핸들러: export_log ---

def test_handle_export_log_csv(tmp_path):
    # 먼저 기록 파일 준비
    from canctl_core.recorder import FrameRecorder
    src = str(tmp_path / "rec.jsonl")
    rec = FrameRecorder()
    rec.start(src)
    rec.record(_frames())
    rec.stop()

    dest = str(tmp_path / "out.csv")
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    # 클라이언트로 등록하지 않아도 요청자(ws)에게 직접 회신되어야 한다(broadcast 아님)
    asyncio.run(srv._handle_command(
        ws, json.dumps({"type": "export_log", "src": src,
                        "dest": dest, "format": "csv"})))
    es = [m for m in ws.sent if m["type"] == "export_status"]
    assert len(es) == 1
    assert es[0]["ok"] is True
    assert es[0]["count"] == 3
    assert es[0]["format"] == "csv"
    assert es[0]["path"] == dest
    import os
    assert os.path.exists(dest)


def test_handle_export_log_missing_src_surfaces_error(tmp_path):
    # src 파일이 없으면 기존 try/except 가 error 로 표면화
    dest = str(tmp_path / "out.csv")
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    asyncio.run(srv._handle_command(
        ws, json.dumps({"type": "export_log",
                        "src": str(tmp_path / "nope.jsonl"),
                        "dest": dest, "format": "csv"})))
    assert any(m["type"] == "error" for m in ws.sent)
    assert not any(m["type"] == "export_status" for m in ws.sent)


# --- 명령 핸들러: 로깅 start/stop ---

def test_handle_start_stop_log(tmp_path):
    path = str(tmp_path / "rec.jsonl")
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)  # log_status 를 받기 위해 클라이언트 등록
    asyncio.run(srv._handle_command(ws, json.dumps({"type": "start_log", "path": path})))
    assert srv._recorder.logging is True
    assert any(m["type"] == "log_status" and m["logging"] for m in ws.sent)

    asyncio.run(srv._handle_command(ws, '{"type":"stop_log"}'))
    assert srv._recorder.logging is False
    assert any(m["type"] == "log_status" and not m["logging"] for m in ws.sent)


def test_disconnect_stops_logging(tmp_path):
    """disconnect 시 열려있던 로그 파일을 닫고 log_status(off)를 통지한다."""
    path = str(tmp_path / "rec.jsonl")
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)
    asyncio.run(srv._handle_command(ws, json.dumps({"type": "start_log", "path": path})))
    assert srv._recorder.logging is True

    asyncio.run(srv._handle_command(ws, '{"type":"disconnect"}'))
    assert srv._recorder.logging is False  # 파일 핸들이 닫혔다
    # disconnect 후 log_status(off) 통지가 있어야 한다
    assert any(m["type"] == "log_status" and not m["logging"] for m in ws.sent)


def test_broadcast_loop_records_live_frames(tmp_path):
    """라이브 poll 프레임이 로그에 기록되는지(broadcast_loop 1회분 모방)."""
    path = str(tmp_path / "rec.jsonl")
    backend = FakeBackend()
    srv = CanServer(backend)
    srv._recorder.start(path)
    backend._queue = _frames()

    # broadcast_loop 의 핵심 1스텝을 재현
    frames = backend.poll()
    srv._recorder.record(frames)
    srv._recorder.stop()

    restored = list(read_frames(path))
    assert [f.can_id for f in restored] == [0x100, 0x200, 0x7FF]


# --- DBC 디코더 부착(필터 통과 프레임에 decoded) ---

class _StubDecoder:
    def decode(self, frame):
        if frame.can_id == 0x100:
            return {"message": "M", "signals": {"s": 1}}
        return None


def test_rx_msg_attaches_decoded_after_filter():
    srv = CanServer(FakeBackend())
    srv._decoder = _StubDecoder()
    msg = json.loads(srv._rx_msg([_frames()[0]]))
    assert msg["frames"][0]["decoded"]["message"] == "M"


# --- replay: 기록 파일을 rx 로 흘려보내고 재기록하지 않음 ---

def test_replay_streams_frames_and_does_not_rerecord(tmp_path):
    # 먼저 기록 파일 준비
    path = str(tmp_path / "rec.jsonl")
    from canctl_core.recorder import FrameRecorder
    rec = FrameRecorder()
    rec.start(path)
    rec.record(_frames())
    rec.stop()

    backend = FakeBackend()
    srv = CanServer(backend)
    ws = FakeWs()
    srv._clients.add(ws)

    async def run_replay():
        # 타이밍 재현을 짧게: ts 가 모두 동일하므로 sleep 없음
        await srv._replay_loop(path)

    asyncio.run(run_replay())

    rx_msgs = [m for m in ws.sent if m["type"] == "rx"]
    replayed_ids = [fr["can_id"] for m in rx_msgs for fr in m["frames"]]
    assert replayed_ids == [0x100, 0x200, 0x7FF]
    # replay 는 recorder 를 건드리지 않는다(로깅 비활성 유지)
    assert srv._recorder.logging is False


def test_replay_applies_filter(tmp_path):
    path = str(tmp_path / "rec.jsonl")
    from canctl_core.recorder import FrameRecorder
    rec = FrameRecorder()
    rec.start(path)
    rec.record(_frames())
    rec.stop()

    backend = FakeBackend()
    srv = CanServer(backend)
    srv._filter_ids = {0x200}
    ws = FakeWs()
    srv._clients.add(ws)

    asyncio.run(srv._replay_loop(path))

    rx_msgs = [m for m in ws.sent if m["type"] == "rx"]
    replayed_ids = [fr["can_id"] for m in rx_msgs for fr in m["frames"]]
    assert replayed_ids == [0x200]  # 필터 통과만


# --- DBC: cantools 미설치 시 안내성 error ---

def test_load_dbc_unavailable_sends_error(monkeypatch):
    import canctl_core.dbc as dbc_mod

    # cantools 가 설치돼 있더라도 미설치 상태를 강제 모방
    monkeypatch.setattr(dbc_mod, "cantools", None)
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    asyncio.run(srv._handle_command(ws, '{"type":"load_dbc","path":"x.dbc"}'))
    assert any(m["type"] == "error" and "cantools" in m["message"] for m in ws.sent)
    assert srv._decoder.loaded is False


# --- send: 송신 프레임을 tx 로 모니터에 echo ---

def test_handle_send_echoes_tx_frame():
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)
    srv._backend.connect(0, 0, 500000)
    asyncio.run(srv._handle_command(ws, '{"type":"send","channel":0,"can_id":291,"data":[1,2,3]}'))
    rx = [m for m in ws.sent if m["type"] == "rx"]
    assert len(rx) == 1
    frame = rx[0]["frames"][0]
    assert frame["can_id"] == 291
    assert frame["dir"] == "tx"
    assert frame["data"] == [1, 2, 3]
