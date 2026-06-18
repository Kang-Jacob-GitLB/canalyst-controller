"""기능 확장 프로토콜(필터/로깅/DBC) 명령·이벤트 빌더 테스트."""
import json

import pytest

from canctl_core import protocol
from canctl_core.protocol import CanFrame, ProtocolError, parse_command


# --- 이벤트 빌더 ---

def test_make_log_status():
    msg = json.loads(protocol.make_log_status(True, "out.jsonl"))
    assert msg["type"] == "log_status"
    assert msg["logging"] is True
    assert msg["path"] == "out.jsonl"
    off = json.loads(protocol.make_log_status(False))
    assert off["logging"] is False
    assert off["path"] is None


def test_make_filter():
    msg = json.loads(protocol.make_filter([0x100, 0x200]))
    assert msg["type"] == "filter"
    assert msg["ids"] == [0x100, 0x200]


def test_make_rx_without_decoder_has_no_decoded():
    frame = CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2])
    msg = json.loads(protocol.make_rx([frame]))
    assert "decoded" not in msg["frames"][0]


class _StubDecoder:
    """0x100 만 디코딩하는 가짜 디코더."""

    def decode(self, frame):
        if frame.can_id == 0x100:
            return {"message": "Test", "signals": {"a": 1}}
        return None


def test_make_rx_with_decoder_attaches_decoded():
    frames = [
        CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2]),
        CanFrame(1.0, 0, 0x200, False, False, 1, [0]),
    ]
    msg = json.loads(protocol.make_rx(frames, decoder=_StubDecoder()))
    assert msg["frames"][0]["decoded"]["message"] == "Test"
    assert "decoded" not in msg["frames"][1]  # 정의 안 된 ID 는 부착 안 됨


class _RaisingDecoder:
    """decode 시 예외를 던지는 디코더(라이브 스트림 보호 검증용)."""

    def decode(self, frame):
        raise RuntimeError("decode boom")


def test_make_rx_decoder_failure_does_not_break_stream():
    # 디코딩이 실패해도 프레임은 decoded 없이 통과해야 한다(rx 스트림 중단 방지)
    frame = CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2])
    msg = json.loads(protocol.make_rx([frame], decoder=_RaisingDecoder()))
    assert len(msg["frames"]) == 1
    assert "decoded" not in msg["frames"][0]


# --- 명령 파싱(정상) ---

def test_parse_set_filter():
    msg = parse_command('{"type":"set_filter","ids":[256,512]}')
    assert msg["ids"] == [256, 512]


def test_parse_set_filter_empty_default():
    msg = parse_command('{"type":"set_filter"}')
    assert msg["ids"] == []


def test_parse_start_log():
    msg = parse_command('{"type":"start_log","path":"log.jsonl"}')
    assert msg["path"] == "log.jsonl"


def test_parse_stop_log():
    assert parse_command('{"type":"stop_log"}')["type"] == "stop_log"


def test_parse_replay():
    assert parse_command('{"type":"replay","path":"log.jsonl"}')["path"] == "log.jsonl"


def test_parse_load_dbc():
    assert parse_command('{"type":"load_dbc","path":"x.dbc"}')["path"] == "x.dbc"


# --- 명령 파싱(비정상) ---

@pytest.mark.parametrize("raw", [
    '{"type":"set_filter","ids":"notlist"}',          # 리스트 아님
    '{"type":"set_filter","ids":[true]}',             # bool 거부
    '{"type":"set_filter","ids":[-1]}',               # 음수 거부
    '{"type":"set_filter","ids":[1.5]}',              # float 거부
    '{"type":"start_log"}',                            # path 누락
    '{"type":"start_log","path":""}',                 # 빈 path
    '{"type":"start_log","path":123}',                # path 정수
    '{"type":"replay"}',                               # path 누락
    '{"type":"load_dbc"}',                             # path 누락
])
def test_parse_invalid_ext(raw):
    with pytest.raises(ProtocolError):
        parse_command(raw)
