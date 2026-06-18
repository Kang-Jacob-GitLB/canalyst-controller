"""DbcDecoder 테스트.

cantools 미설치 환경을 가정한다. 설치/미설치 양쪽에서 안전하게 동작해야 한다.
"""
import pytest

import canctl_core.dbc as dbc_mod
from canctl_core.dbc import DbcDecoder, DbcUnavailable, _jsonable
from canctl_core.protocol import CanFrame


def test_module_imports_without_cantools():
    # import 단계에서 죽지 않아야 한다(미설치여도 모듈 로드 성공)
    assert hasattr(dbc_mod, "CANTOOLS_AVAILABLE")
    assert isinstance(dbc_mod.CANTOOLS_AVAILABLE, bool)


def test_decode_without_load_returns_none():
    dec = DbcDecoder()
    assert dec.loaded is False
    frame = CanFrame(1.0, 0, 0x100, False, False, 2, [1, 2])
    assert dec.decode(frame) is None  # 미로드 시 조용히 통과


def test_load_raises_when_cantools_missing(monkeypatch):
    monkeypatch.setattr(dbc_mod, "cantools", None)
    dec = DbcDecoder()
    with pytest.raises(DbcUnavailable):
        dec.load("nonexistent.dbc")
    assert dec.loaded is False


def test_jsonable_normalizes_values():
    assert _jsonable(3) == 3
    assert _jsonable(1.5) == 1.5
    assert _jsonable("x") == "x"
    assert _jsonable(True) is True
    assert _jsonable(None) is None

    class _Named:
        def __str__(self):
            return "OPEN"

    assert _jsonable(_Named()) == "OPEN"  # NamedSignalValue 류는 문자열로
