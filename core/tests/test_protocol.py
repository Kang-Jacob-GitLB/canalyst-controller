import json

import pytest

from canctl_core import protocol
from canctl_core.protocol import CanFrame, ProtocolError, parse_command


def test_canframe_to_dict():
    frame = CanFrame(ts=1.5, channel=0, can_id=0x100,
                     extended=False, rtr=False, dlc=2, data=[1, 2])
    d = frame.to_dict()
    assert d["can_id"] == 0x100
    assert d["data"] == [1, 2]
    assert d["dlc"] == 2


def test_make_rx():
    frame = CanFrame(1.0, 0, 0x1, False, False, 1, [0xFF])
    msg = json.loads(protocol.make_rx([frame]))
    assert msg["type"] == "rx"
    assert msg["frames"][0]["data"] == [0xFF]


def test_make_status_error_devices():
    assert json.loads(protocol.make_status(True, "mock"))["connected"] is True
    assert json.loads(protocol.make_error("x"))["message"] == "x"
    assert json.loads(protocol.make_devices([{"index": 0}]))["list"][0]["index"] == 0


def test_parse_list_devices():
    assert parse_command('{"type":"list_devices"}')["type"] == "list_devices"


def test_parse_connect_ok():
    msg = parse_command('{"type":"connect","device_index":0,"channel":1,"bitrate":500000}')
    assert msg["channel"] == 1
    assert msg["bitrate"] == 500000


def test_parse_connect_with_bitrate1():
    msg = parse_command(
        '{"type":"connect","device_index":0,"channel":0,'
        '"bitrate":500000,"bitrate1":250000}')
    assert msg["bitrate"] == 500000
    assert msg["bitrate1"] == 250000


def test_parse_connect_bitrate1_optional():
    # bitrate1 생략 시 키가 없고(=하위호환), 검증도 통과한다.
    msg = parse_command('{"type":"connect","device_index":0,"channel":0,"bitrate":500000}')
    assert "bitrate1" not in msg


def test_parse_send_defaults():
    msg = parse_command('{"type":"send","channel":0,"can_id":291,"data":[1,2,3]}')
    assert msg["extended"] is False
    assert msg["rtr"] is False
    assert msg["data"] == [1, 2, 3]


def test_parse_send_without_data():
    msg = parse_command('{"type":"send","channel":0,"can_id":1}')
    assert msg["data"] == []


@pytest.mark.parametrize("raw", [
    "not json",                                                          # JSON 아님
    "[]",                                                                # 객체 아님
    '{"type":"unknown"}',                                                # 알 수 없는 명령
    '{"type":"connect","channel":0,"bitrate":1}',                        # device_index 누락
    '{"type":"connect","device_index":0,"channel":0,"bitrate":true}',    # bool bitrate
    '{"type":"connect","device_index":0,"channel":0,"bitrate":1,"bitrate1":true}',  # bool bitrate1
    '{"type":"send","channel":0,"can_id":1,"data":[256]}',               # 바이트 범위 초과
    '{"type":"send","channel":0,"can_id":1,"data":[1,2,3,4,5,6,7,8,9]}',  # 8바이트 초과
])
def test_parse_invalid(raw):
    with pytest.raises(ProtocolError):
        parse_command(raw)
