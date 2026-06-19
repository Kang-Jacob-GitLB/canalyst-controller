"""DBC 메시지 인코딩 송신 코어 테스트(list_messages/encode + 새 프로토콜 명령).

실제 cantools 로 samples/example.dbc 를 로드해 검증한다. cantools 미설치
환경에서는 컬렉션이 깨지지 않도록 importorskip 한다(기존 test_dbc.py 는
미설치 가정의 별도 테스트).
"""
import json
from pathlib import Path

import pytest

from canctl_core import protocol
from canctl_core.protocol import ProtocolError, parse_command

# 인코딩 검증은 실제 cantools 가 있어야 한다(미설치 시 이 파일 전체 skip)
pytest.importorskip("cantools")

from canctl_core.dbc import DbcDecoder  # noqa: E402  (importorskip 뒤 import)

#: 샘플 DBC 경로(repo 루트/samples). 테스트 파일=core/tests/X.py → parents[2]=repo 루트
SAMPLE_DBC = str(Path(__file__).resolve().parents[2] / "samples" / "example.dbc")


@pytest.fixture
def decoder() -> DbcDecoder:
    dec = DbcDecoder()
    dec.load(SAMPLE_DBC)
    return dec


# --- DbcDecoder.list_messages ---

def test_list_messages_none_when_unloaded():
    assert DbcDecoder().list_messages() is None  # 미로드면 None(서버가 안내)


def test_list_messages_returns_message_specs(decoder):
    msgs = decoder.list_messages()
    by_name = {m["name"]: m for m in msgs}
    assert set(by_name) == {"EngineData", "VehicleSpeed"}

    engine = by_name["EngineData"]
    assert engine["frame_id"] == 256
    assert engine["is_extended"] is False
    assert engine["length"] == 4

    speed = by_name["VehicleSpeed"]
    assert speed["frame_id"] == 512
    assert speed["length"] == 3


def test_list_messages_includes_signal_metadata(decoder):
    engine = next(m for m in decoder.list_messages() if m["name"] == "EngineData")
    sigs = {s["name"]: s for s in engine["signals"]}
    assert set(sigs) == {"EngineRPM", "EngineTemp"}

    rpm = sigs["EngineRPM"]
    assert rpm["minimum"] == 0
    assert rpm["maximum"] == 8000
    assert rpm["unit"] == "rpm"

    temp = sigs["EngineTemp"]
    assert temp["minimum"] == -40
    assert temp["maximum"] == 215
    assert temp["unit"] == "degC"


def test_list_messages_unspecified_signal_meta_is_null(decoder):
    """범위·단위를 정의하지 않은 신호는 minimum/maximum/unit 가 None(JSON null).

    UI 가 null 을 받는 실제 경로를 검증한다(Gear 는 example.dbc 에서 미지정).
    """
    speed = next(m for m in decoder.list_messages() if m["name"] == "VehicleSpeed")
    gear = next(s for s in speed["signals"] if s["name"] == "Gear")
    assert gear["minimum"] is None
    assert gear["maximum"] is None
    assert gear["unit"] is None
    # JSON 직렬화 시 null 로 떨어지는지 확인
    dumped = json.loads(protocol.make_dbc_messages(decoder.list_messages()))
    g = next(s for m in dumped["messages"] if m["name"] == "VehicleSpeed"
             for s in m["signals"] if s["name"] == "Gear")
    assert g["minimum"] is None and g["maximum"] is None and g["unit"] is None


# --- DbcDecoder.encode ---

def test_encode_returns_frame_id_extended_and_byte_list(decoder):
    frame_id, is_extended, data = decoder.encode(
        "EngineData", {"EngineRPM": 3000, "EngineTemp": 90})
    assert frame_id == 256
    assert is_extended is False
    # bytes 가 아니라 JSON 직렬화 가능한 정수 리스트여야 한다
    assert isinstance(data, list)
    assert all(isinstance(b, int) for b in data)
    assert data == [184, 11, 130, 0]


def test_encode_round_trips_through_decode(decoder):
    """encode 결과를 decode 로 되돌려 동일 신호값이 나오는지(결정적 왕복)."""
    from canctl_core.protocol import CanFrame

    frame_id, is_extended, data = decoder.encode(
        "VehicleSpeed", {"Speed": 120, "Gear": 3})
    assert frame_id == 512 and data == [120, 0, 3]

    frame = CanFrame(0.0, 0, frame_id, is_extended, False, len(data), data)
    decoded = decoder.decode(frame)
    assert decoded["message"] == "VehicleSpeed"
    assert decoded["signals"]["Speed"] == 120
    assert decoded["signals"]["Gear"] == 3


@pytest.mark.parametrize("name,signals", [
    ("NoSuchMessage", {}),                              # 없는 메시지
    ("EngineData", {"EngineRPM": 99999, "EngineTemp": 90}),  # 범위 초과
    ("EngineData", {"EngineRPM": 3000}),               # 신호 누락
])
def test_encode_errors_become_value_error(decoder, name, signals):
    with pytest.raises(ValueError):
        decoder.encode(name, signals)


# --- protocol: 새 명령 파싱(정상) ---

def test_parse_list_dbc_messages():
    assert parse_command('{"type":"list_dbc_messages"}')["type"] == "list_dbc_messages"


def test_parse_encode_send_ok():
    msg = parse_command(json.dumps({
        "type": "encode_send", "message": "EngineData", "channel": 0,
        "signals": {"EngineRPM": 3000, "EngineTemp": 90},
    }))
    assert msg["message"] == "EngineData"
    assert msg["channel"] == 0
    assert msg["signals"]["EngineRPM"] == 3000


# --- protocol: 새 명령 파싱(비정상) ---

@pytest.mark.parametrize("raw", [
    '{"type":"encode_send","channel":0,"signals":{}}',                 # message 누락
    '{"type":"encode_send","message":"","channel":0,"signals":{}}',    # 빈 message
    '{"type":"encode_send","message":"M","signals":{}}',               # channel 누락
    '{"type":"encode_send","message":"M","channel":"x","signals":{}}',  # channel 정수 아님
    '{"type":"encode_send","message":"M","channel":0}',                # signals 누락
    '{"type":"encode_send","message":"M","channel":0,"signals":[]}',   # signals 리스트(객체 아님)
    '{"type":"encode_send","message":"M","channel":0,"signals":5}',    # signals 정수
])
def test_parse_encode_send_invalid(raw):
    with pytest.raises(ProtocolError):
        parse_command(raw)


# --- protocol: 빌더 ---

def test_make_dbc_messages():
    msg = json.loads(protocol.make_dbc_messages([{"name": "EngineData"}]))
    assert msg["type"] == "dbc_messages"
    assert msg["messages"][0]["name"] == "EngineData"
