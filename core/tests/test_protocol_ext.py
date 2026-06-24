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
    # mask 미지정 시 all-ones(정확 일치), channel 미지정 시 null(전체 채널)
    assert msg["mask"] == 0xFFFFFFFF
    assert msg["channel"] is None


def test_make_filter_with_mask_and_channel():
    msg = json.loads(protocol.make_filter([0x100], mask=0x700, channel=0))
    assert msg["ids"] == [0x100]
    assert msg["mask"] == 0x700
    assert msg["channel"] == 0  # channel=0 은 유효값(falsy 아님)


def test_make_filter_mask_zero_preserved():
    # mask=0 은 유효(모든 id 매칭). all-ones 로 대체되면 안 된다.
    msg = json.loads(protocol.make_filter([0x100], mask=0))
    assert msg["mask"] == 0


def test_make_export_status():
    msg = json.loads(protocol.make_export_status(True, "out.asc", 5, "asc"))
    assert msg["type"] == "export_status"
    assert msg["ok"] is True
    assert msg["path"] == "out.asc"
    assert msg["count"] == 5
    assert msg["format"] == "asc"


def test_make_periodic_status():
    tasks = [{"id": 1, "channel": 0, "can_id": 0x100, "extended": False,
              "rtr": False, "data": [1, 2], "period": 0.5, "count": None, "sent": 3}]
    msg = json.loads(protocol.make_periodic_status(tasks))
    assert msg["type"] == "periodic_status"
    assert msg["tasks"][0]["id"] == 1
    assert msg["tasks"][0]["count"] is None  # 무한 반복
    assert msg["tasks"][0]["sent"] == 3


def test_make_periodic_status_empty():
    # 빈 목록 = 진행 중인 주기 송신 없음
    assert json.loads(protocol.make_periodic_status([]))["tasks"] == []


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


def test_parse_set_filter_with_mask_and_channel():
    msg = parse_command('{"type":"set_filter","ids":[256],"mask":1792,"channel":0}')
    assert msg["ids"] == [256]
    assert msg["mask"] == 1792
    assert msg["channel"] == 0  # channel=0 허용


def test_parse_set_filter_mask_zero_allowed():
    # mask=0 은 허용(모든 id 매칭). setdefault 하지 않으므로 키 그대로 유지.
    msg = parse_command('{"type":"set_filter","ids":[256],"mask":0}')
    assert msg["mask"] == 0


def test_parse_set_filter_channel_null_allowed():
    # channel=null(None) 은 전체 채널을 뜻하며 허용.
    msg = parse_command('{"type":"set_filter","ids":[256],"channel":null}')
    assert msg["channel"] is None


def test_parse_set_filter_no_mask_channel_keys():
    # mask/channel 미지정 시 server 가 기본 처리하므로 키를 추가하지 않는다.
    msg = parse_command('{"type":"set_filter","ids":[256]}')
    assert "mask" not in msg
    assert "channel" not in msg


def test_parse_export_log():
    msg = parse_command('{"type":"export_log","src":"a.jsonl","dest":"b.csv","format":"csv"}')
    assert msg["type"] == "export_log"
    assert msg["src"] == "a.jsonl"
    assert msg["dest"] == "b.csv"
    assert msg["format"] == "csv"


def test_parse_export_log_asc():
    msg = parse_command('{"type":"export_log","src":"a.jsonl","dest":"b.asc","format":"asc"}')
    assert msg["format"] == "asc"


def test_parse_export_log_blf():
    msg = parse_command('{"type":"export_log","src":"a.jsonl","dest":"b.blf","format":"blf"}')
    assert msg["format"] == "blf"


def test_parse_send_periodic_defaults():
    # period 만 필수. data/extended/rtr 는 send 와 같은 기본값, count 는 미지정(무한).
    msg = parse_command('{"type":"send_periodic","channel":0,"can_id":256,"period":0.5}')
    assert msg["period"] == 0.5
    assert msg["data"] == []
    assert msg["extended"] is False
    assert msg["rtr"] is False
    assert "count" not in msg


def test_parse_send_periodic_with_count_and_data():
    # 정수 period 도 허용, count 와 data 동반.
    msg = parse_command(
        '{"type":"send_periodic","channel":1,"can_id":256,"period":1,"count":5,"data":[1,2,3]}')
    assert msg["period"] == 1
    assert msg["count"] == 5
    assert msg["data"] == [1, 2, 3]


def test_parse_stop_periodic_without_id():
    # id 생략 = 전체 중지
    msg = parse_command('{"type":"stop_periodic"}')
    assert msg["type"] == "stop_periodic"
    assert "id" not in msg


def test_parse_stop_periodic_with_id():
    msg = parse_command('{"type":"stop_periodic","id":3}')
    assert msg["id"] == 3


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
    '{"type":"set_filter","mask":-1}',                # mask 음수 거부
    '{"type":"set_filter","mask":true}',              # mask bool 거부
    '{"type":"set_filter","mask":1.5}',               # mask float 거부
    '{"type":"set_filter","channel":-1}',             # channel 음수 거부
    '{"type":"set_filter","channel":true}',           # channel bool 거부
    '{"type":"set_filter","channel":1.5}',            # channel float 거부
    '{"type":"start_log"}',                            # path 누락
    '{"type":"start_log","path":""}',                 # 빈 path
    '{"type":"start_log","path":123}',                # path 정수
    '{"type":"replay"}',                               # path 누락
    '{"type":"load_dbc"}',                             # path 누락
    '{"type":"export_log","dest":"b.csv","format":"csv"}',     # src 누락
    '{"type":"export_log","src":"a.jsonl","format":"csv"}',    # dest 누락
    '{"type":"export_log","src":"a.jsonl","dest":"b.csv"}',    # format 누락
    '{"type":"export_log","src":"","dest":"b.csv","format":"csv"}',   # 빈 src
    '{"type":"export_log","src":"a.jsonl","dest":"b.xml","format":"xml"}',  # 미지원 포맷
    '{"type":"export_log","src":"a.jsonl","dest":"b.csv","format":""}',     # 빈 format
    '{"type":"send_periodic","channel":0,"can_id":1}',                      # period 누락
    '{"type":"send_periodic","channel":0,"can_id":1,"period":0}',           # period 0
    '{"type":"send_periodic","channel":0,"can_id":1,"period":-1}',          # period 음수
    '{"type":"send_periodic","channel":0,"can_id":1,"period":true}',        # period bool
    '{"type":"send_periodic","channel":0,"can_id":1,"period":0.1,"count":0}',   # count 0
    '{"type":"send_periodic","channel":0,"can_id":1,"period":0.1,"count":1.5}', # count float
    '{"type":"send_periodic","can_id":1,"period":0.1}',                     # channel 누락
    '{"type":"send_periodic","channel":0,"can_id":1,"period":0.1,"data":[256]}',  # 바이트 초과
    '{"type":"stop_periodic","id":-1}',                                     # id 음수
    '{"type":"stop_periodic","id":true}',                                   # id bool
])
def test_parse_invalid_ext(raw):
    with pytest.raises(ProtocolError):
        parse_command(raw)
