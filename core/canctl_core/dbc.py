"""DBC 기반 CAN 프레임 신호 디코딩(cantools 사용).

cantools 는 **선택적 의존성**이다. 미설치 시에도 import 에러로 죽지 않으며,
디코더 사용 시 안내용 예외(DbcUnavailable)를 던진다. server 는 이를 잡아
error 메시지로 클라이언트에 안내한다.
"""
from __future__ import annotations

from typing import Any

from .protocol import CanFrame

try:  # cantools 는 선택적 의존성(미설치 시 기능 비활성)
    import cantools  # type: ignore
except ImportError:  # pragma: no cover - 설치 환경에 따라 분기
    cantools = None


#: cantools 설치 여부(서버에서 사전 점검·안내용)
CANTOOLS_AVAILABLE = cantools is not None


class DbcUnavailable(RuntimeError):
    """cantools 미설치 등으로 DBC 기능을 쓸 수 없을 때."""


class DbcDecoder:
    """DBC 파일을 로드해 CAN 프레임을 신호 dict 로 디코딩한다."""

    def __init__(self) -> None:
        self._db: Any = None
        self._path: str | None = None

    @property
    def loaded(self) -> bool:
        return self._db is not None

    @property
    def path(self) -> str | None:
        return self._path

    def load(self, path: str) -> None:
        """DBC 파일을 로드. cantools 미설치 시 DbcUnavailable."""
        if cantools is None:
            raise DbcUnavailable(
                "cantools 가 설치되어 있지 않습니다. DBC 디코딩을 사용하려면 cantools 를 설치하세요"
            )
        self._db = cantools.database.load_file(path)
        self._path = path

    def decode(self, frame: CanFrame) -> dict | None:
        """프레임을 {message_name, signals} 로 디코딩. 정의되지 않은 ID 면 None.

        DBC 미로드 상태면 None 을 반환한다(디코딩 불가는 조용히 통과).
        """
        if self._db is None:
            return None
        try:
            message = self._db.get_message_by_frame_id(frame.can_id)
            signals = message.decode(bytes(frame.data))
        except (KeyError, ValueError):
            # 정의되지 않은 ID 또는 디코딩 실패는 None 으로 처리
            return None
        # cantools 가 돌려주는 값(NamedSignalValue 등)을 JSON 직렬화 가능하게 정규화
        return {
            "message": message.name,
            "signals": {name: _jsonable(value) for name, value in signals.items()},
        }

    def list_messages(self) -> list[dict] | None:
        """로드된 DBC 의 메시지·신호 메타데이터 목록을 반환.

        UI 가 송신 폼을 구성할 수 있도록 각 메시지의 이름/ID/길이와 신호별
        이름·범위·단위를 제공한다. 미로드 상태면 None(서버가 안내성 error 처리).
        minimum/maximum/unit 은 DBC 에 정의되지 않았으면 None 일 수 있다.
        """
        if self._db is None:
            return None
        messages = []
        for message in self._db.messages:
            signals = [
                {
                    "name": signal.name,
                    "minimum": signal.minimum,
                    "maximum": signal.maximum,
                    "unit": signal.unit,
                }
                for signal in message.signals
            ]
            messages.append({
                "name": message.name,
                "frame_id": message.frame_id,
                "is_extended": message.is_extended_frame,
                "length": message.length,
                "signals": signals,
            })
        return messages

    def encode(self, name: str, signals: dict) -> tuple[int, bool, list[int]]:
        """메시지 이름과 신호 dict 를 받아 (frame_id, is_extended, data) 로 인코딩.

        data 는 0..255 정수 리스트(서버가 그대로 backend.send 와 make_rx 에 사용).
        없는 메시지/누락 신호/범위 초과 등 cantools 인코딩 오류는 읽기 쉬운
        ValueError 로 변환해 서버가 error 로 표면화하게 한다.
        DBC 미로드 상태에서 호출되면 안 되며(서버가 사전 차단), 호출되면 ValueError.
        """
        if self._db is None:
            raise ValueError("DBC 가 로드되지 않았습니다")
        try:
            message = self._db.get_message_by_name(name)
            data = message.encode(signals)
        except Exception as exc:  # KeyError/EncodeError 등 다양한 예외를 통합 처리
            raise ValueError(f"인코딩 실패: {exc}") from exc
        return message.frame_id, message.is_extended_frame, list(data)


def _jsonable(value: Any) -> Any:
    """cantools 신호 값을 JSON 직렬화 가능한 형태로 변환."""
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    # NamedSignalValue 등은 문자열로 표현
    return str(value)
