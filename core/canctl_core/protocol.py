"""WebSocket JSON 프로토콜: CAN 프레임 표현, 서버 이벤트 빌더, 클라이언트 명령 파싱·검증."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

# 지원하는 클라이언트 명령
VALID_COMMANDS = {
    "list_devices", "connect", "disconnect", "send",
    "set_filter", "start_log", "stop_log", "replay", "load_dbc",
    "list_dbc_messages", "encode_send", "export_log",
}

#: 마스크 미지정 시 기본(정확 일치). 32비트 all-ones.
DEFAULT_MASK = 0xFFFFFFFF

#: export_log 지원 포맷.
EXPORT_FORMATS = {"asc", "csv"}


class ProtocolError(ValueError):
    """잘못된 클라이언트 메시지."""


@dataclass
class CanFrame:
    """단일 CAN 프레임. data는 0..8개의 0..255 정수."""

    ts: float
    channel: int
    can_id: int
    extended: bool
    rtr: bool
    dlc: int
    data: list[int]
    dir: str = "rx"  # "rx" 수신 / "tx" 송신

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "channel": self.channel,
            "can_id": self.can_id,
            "extended": self.extended,
            "rtr": self.rtr,
            "dlc": self.dlc,
            "data": list(self.data),
            "dir": self.dir,
        }


# --- Server→Client 이벤트 빌더 ---

def make_rx(frames: list[CanFrame], decoder: Any = None) -> str:
    """rx 이벤트 직렬화. decoder 가 주어지면 각 프레임에 decoded(신호) 정보를 부착.

    decoder.decode(frame) 가 None 이 아니면 프레임 dict 에 "decoded" 키로 합친다.
    decoder 가 None 이면 기존 동작과 동일(decoded 키 없음).
    """
    out = []
    for f in frames:
        d = f.to_dict()
        if decoder is not None:
            try:
                decoded = decoder.decode(f)
            except Exception:
                # 디코딩 실패가 라이브 RX 스트림을 끊지 않도록 방어(decoded 생략하고 통과)
                decoded = None
            if decoded is not None:
                d["decoded"] = decoded
        out.append(d)
    return json.dumps({"type": "rx", "frames": out})


def make_status(connected: bool, backend: str,
                device: Any = None, channels: Any = None) -> str:
    return json.dumps({
        "type": "status",
        "connected": connected,
        "backend": backend,
        "device": device,
        "channels": channels,
    })


def make_devices(devices: list[dict]) -> str:
    return json.dumps({"type": "devices", "list": devices})


def make_error(message: str) -> str:
    return json.dumps({"type": "error", "message": message})


def make_log_status(logging: bool, path: Any = None) -> str:
    """파일 로깅 상태 통지(start_log/stop_log 결과)."""
    return json.dumps({"type": "log_status", "logging": logging, "path": path})


def make_filter(ids: list[int], mask: int | None = None,
                channel: int | None = None) -> str:
    """현재 적용된 수신 필터 통지.

    - ids 빈 목록이면 (id 기준) 전체 통과.
    - mask 가 None 이면 DEFAULT_MASK(all-ones, 정확 일치)로 통지.
    - channel 이 None 이면 전체 채널(채널 필터 없음).
    """
    return json.dumps({
        "type": "filter",
        "ids": list(ids),
        "mask": DEFAULT_MASK if mask is None else mask,
        "channel": channel,
    })


def make_export_status(ok: bool, path: str, count: int, format: str) -> str:
    """로그 내보내기 결과 통지(export_log 응답). 요청자에게만 회신."""
    return json.dumps({
        "type": "export_status",
        "ok": ok,
        "path": path,
        "count": count,
        "format": format,
    })


def make_dbc_messages(messages: list[dict]) -> str:
    """로드된 DBC 의 메시지·신호 메타데이터 통지(list_dbc_messages 응답)."""
    return json.dumps({"type": "dbc_messages", "messages": list(messages)})


# --- Client→Server 명령 파싱·검증 ---

def parse_command(raw: str) -> dict[str, Any]:
    """원시 JSON 문자열을 검증된 명령 dict로 변환. 실패 시 ProtocolError."""
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"JSON 파싱 실패: {exc}") from exc
    if not isinstance(msg, dict):
        raise ProtocolError("명령은 JSON 객체여야 합니다")

    cmd = msg.get("type")
    if cmd not in VALID_COMMANDS:
        raise ProtocolError(f"알 수 없는 명령: {cmd!r}")

    if cmd == "connect":
        _require_int(msg, "device_index")
        _require_int(msg, "channel")
        _require_int(msg, "bitrate")
    elif cmd == "send":
        _require_int(msg, "channel")
        _require_int(msg, "can_id")
        _validate_data(msg.get("data", []))
        msg.setdefault("data", [])
        msg.setdefault("extended", False)
        msg.setdefault("rtr", False)
    elif cmd == "set_filter":
        _validate_ids(msg.get("ids", []))
        msg.setdefault("ids", [])
        # mask/channel 은 optional. 키가 있을 때만 검증하고,
        # 없으면 server 가 기본 처리하므로 setdefault 하지 않는다.
        if "mask" in msg:
            _validate_mask(msg["mask"])
        if "channel" in msg:
            _validate_filter_channel(msg["channel"])
    elif cmd == "export_log":
        _require_str(msg, "src")
        _require_str(msg, "dest")
        _require_str(msg, "format")
        if msg["format"] not in EXPORT_FORMATS:
            raise ProtocolError(
                f"format 은 {sorted(EXPORT_FORMATS)} 중 하나여야 합니다")
    elif cmd == "start_log":
        _require_str(msg, "path")
    elif cmd == "replay":
        _require_str(msg, "path")
    elif cmd == "load_dbc":
        _require_str(msg, "path")
    elif cmd == "encode_send":
        _require_str(msg, "message")
        _require_int(msg, "channel")
        _require_dict(msg, "signals")
    # list_dbc_messages 는 추가 인자가 없다(검증 불필요)
    return msg


def _require_int(msg: dict, key: str) -> None:
    if key not in msg:
        raise ProtocolError(f"필수 필드 누락: {key}")
    value = msg[key]
    # bool 은 int 의 서브클래스이므로 명시적으로 거부
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolError(f"필드 {key} 는 정수여야 합니다")


def _require_str(msg: dict, key: str) -> None:
    if key not in msg:
        raise ProtocolError(f"필수 필드 누락: {key}")
    value = msg[key]
    if not isinstance(value, str) or not value:
        raise ProtocolError(f"필드 {key} 는 비어있지 않은 문자열이어야 합니다")


def _require_dict(msg: dict, key: str) -> None:
    if key not in msg:
        raise ProtocolError(f"필수 필드 누락: {key}")
    value = msg[key]
    # bool/list 등은 dict 가 아니며, JSON 객체만 허용한다
    if not isinstance(value, dict):
        raise ProtocolError(f"필드 {key} 는 객체여야 합니다")


def _validate_data(data: Any) -> None:
    if not isinstance(data, list) or len(data) > 8:
        raise ProtocolError("data 는 최대 8개의 리스트여야 합니다")
    for byte in data:
        if isinstance(byte, bool) or not isinstance(byte, int) or not (0 <= byte <= 255):
            raise ProtocolError("data 의 각 원소는 0..255 정수여야 합니다")


def _validate_ids(ids: Any) -> None:
    if not isinstance(ids, list):
        raise ProtocolError("ids 는 리스트여야 합니다")
    for can_id in ids:
        # bool 은 int 의 서브클래스이므로 명시적으로 거부
        if isinstance(can_id, bool) or not isinstance(can_id, int) or can_id < 0:
            raise ProtocolError("ids 의 각 원소는 0 이상의 정수여야 합니다")


def _validate_mask(mask: Any) -> None:
    # mask=0 은 허용(모든 id 가 모든 프레임 매칭). bool 은 명시적으로 거부.
    if isinstance(mask, bool) or not isinstance(mask, int) or mask < 0:
        raise ProtocolError("mask 는 0 이상의 정수여야 합니다")


def _validate_filter_channel(channel: Any) -> None:
    # channel=null(None) 은 전체 채널을 뜻하므로 허용. channel=0 도 유효.
    if channel is None:
        return
    if isinstance(channel, bool) or not isinstance(channel, int) or channel < 0:
        raise ProtocolError("channel 은 0 이상의 정수 또는 null 이어야 합니다")
