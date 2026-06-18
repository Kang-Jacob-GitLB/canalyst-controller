"""WebSocket JSON 프로토콜: CAN 프레임 표현, 서버 이벤트 빌더, 클라이언트 명령 파싱·검증."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

# 지원하는 클라이언트 명령
VALID_COMMANDS = {"list_devices", "connect", "disconnect", "send"}


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

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "channel": self.channel,
            "can_id": self.can_id,
            "extended": self.extended,
            "rtr": self.rtr,
            "dlc": self.dlc,
            "data": list(self.data),
        }


# --- Server→Client 이벤트 빌더 ---

def make_rx(frames: list[CanFrame]) -> str:
    return json.dumps({"type": "rx", "frames": [f.to_dict() for f in frames]})


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
    return msg


def _require_int(msg: dict, key: str) -> None:
    if key not in msg:
        raise ProtocolError(f"필수 필드 누락: {key}")
    value = msg[key]
    # bool 은 int 의 서브클래스이므로 명시적으로 거부
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolError(f"필드 {key} 는 정수여야 합니다")


def _validate_data(data: Any) -> None:
    if not isinstance(data, list) or len(data) > 8:
        raise ProtocolError("data 는 최대 8개의 리스트여야 합니다")
    for byte in data:
        if isinstance(byte, bool) or not isinstance(byte, int) or not (0 <= byte <= 255):
            raise ProtocolError("data 의 각 원소는 0..255 정수여야 합니다")
