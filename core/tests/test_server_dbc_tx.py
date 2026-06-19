"""CanServer 의 DBC 송신 명령(list_dbc_messages/encode_send) 핸들러 테스트.

test_server_ext.py 와 동일하게 가짜 ws/백엔드로 코루틴을 asyncio.run 으로 구동한다.
encode_send 검증은 실제 cantools 로 samples/example.dbc 를 로드하므로 importorskip.
"""
import asyncio
import json
from pathlib import Path

import pytest

from canctl_core.backend import CanBackend
from canctl_core.server import CanServer

pytest.importorskip("cantools")

SAMPLE_DBC = str(Path(__file__).resolve().parents[2] / "samples" / "example.dbc")


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
        self.sent_calls = []  # (channel, can_id, extended, rtr, data)

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
        self.sent_calls.append((channel, can_id, extended, rtr, list(data)))

    def poll(self):
        return []


# --- list_dbc_messages ---

def test_list_dbc_messages_unloaded_sends_error():
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    asyncio.run(srv._handle_command(ws, '{"type":"list_dbc_messages"}'))
    assert any(m["type"] == "error" and "DBC" in m["message"] for m in ws.sent)


def test_list_dbc_messages_loaded_sends_to_requester_only():
    srv = CanServer(FakeBackend())
    srv._decoder.load(SAMPLE_DBC)
    ws, other = FakeWs(), FakeWs()
    srv._clients.add(ws)
    srv._clients.add(other)
    asyncio.run(srv._handle_command(ws, '{"type":"list_dbc_messages"}'))

    dm = [m for m in ws.sent if m["type"] == "dbc_messages"]
    assert len(dm) == 1
    names = {x["name"] for x in dm[0]["messages"]}
    assert names == {"EngineData", "VehicleSpeed"}
    # 요청자에게만 회신(broadcast 아님)
    assert not any(m["type"] == "dbc_messages" for m in other.sent)


# --- encode_send ---

def test_encode_send_unloaded_sends_error_and_does_not_send():
    srv = CanServer(FakeBackend())
    ws = FakeWs()
    srv._clients.add(ws)
    asyncio.run(srv._handle_command(ws, json.dumps({
        "type": "encode_send", "message": "EngineData", "channel": 0,
        "signals": {"EngineRPM": 3000, "EngineTemp": 90},
    })))
    assert any(m["type"] == "error" and "DBC" in m["message"] for m in ws.sent)
    assert srv._backend.sent_calls == []  # 미로드면 송신하지 않음


def test_encode_send_encodes_sends_and_broadcasts_tx():
    srv = CanServer(FakeBackend())
    srv._decoder.load(SAMPLE_DBC)
    ws, other = FakeWs(), FakeWs()
    srv._clients.add(ws)
    srv._clients.add(other)
    srv._backend.connect(0, 0, 500000)

    asyncio.run(srv._handle_command(ws, json.dumps({
        "type": "encode_send", "message": "EngineData", "channel": 0,
        "signals": {"EngineRPM": 3000, "EngineTemp": 90},
    })))

    # 인코딩된 바이트로 백엔드 송신
    assert srv._backend.sent_calls == [(0, 256, False, False, [184, 11, 130, 0])]

    # tx 프레임이 모든 클라이언트에 echo(broadcast) 되고, 디코더로 decoded 부착
    for w in (ws, other):
        rx = [m for m in w.sent if m["type"] == "rx"]
        assert len(rx) == 1
        frame = rx[0]["frames"][0]
        assert frame["can_id"] == 256
        assert frame["dir"] == "tx"
        assert frame["data"] == [184, 11, 130, 0]
        assert frame["decoded"]["message"] == "EngineData"
        assert frame["decoded"]["signals"]["EngineRPM"] == 3000


def test_encode_send_out_of_range_sends_clean_error_and_does_not_send():
    srv = CanServer(FakeBackend())
    srv._decoder.load(SAMPLE_DBC)
    ws = FakeWs()
    srv._clients.add(ws)
    srv._backend.connect(0, 0, 500000)

    asyncio.run(srv._handle_command(ws, json.dumps({
        "type": "encode_send", "message": "EngineData", "channel": 0,
        "signals": {"EngineRPM": 99999, "EngineTemp": 90},
    })))

    errs = [m for m in ws.sent if m["type"] == "error"]
    assert errs and "인코딩 실패" in errs[-1]["message"]
    assert srv._backend.sent_calls == []  # 인코딩 실패 시 송신하지 않음
