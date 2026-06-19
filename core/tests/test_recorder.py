"""FrameRecorder 기록·JSONL 왕복·read_frames·export_log 테스트."""
import csv
import json

import pytest

from canctl_core.protocol import CanFrame
from canctl_core.recorder import (
    FrameRecorder,
    export_log,
    frame_from_dict,
    read_frames,
)


def _sample_frames():
    return [
        CanFrame(ts=1.0, channel=0, can_id=0x100, extended=False, rtr=False,
                 dlc=2, data=[1, 2]),
        CanFrame(ts=1.1, channel=1, can_id=0x18FF0001, extended=True, rtr=False,
                 dlc=3, data=[0xAA, 0xBB, 0xCC]),
        CanFrame(ts=1.2, channel=0, can_id=0x7FF, extended=False, rtr=True,
                 dlc=0, data=[]),
    ]


def test_recorder_not_logging_by_default():
    rec = FrameRecorder()
    assert rec.logging is False
    assert rec.path is None
    # 기록 중이 아니면 record 는 무시(예외 없음)
    rec.record(_sample_frames())


def test_record_and_roundtrip(tmp_path):
    path = str(tmp_path / "log.jsonl")
    rec = FrameRecorder()
    rec.start(path)
    assert rec.logging is True
    assert rec.path == path
    frames = _sample_frames()
    rec.record(frames[:2])
    rec.record(frames[2:])
    closed = rec.stop()
    assert closed == path
    assert rec.logging is False

    # 한 줄=한 프레임
    with open(path, encoding="utf-8") as fp:
        lines = [line for line in fp if line.strip()]
    assert len(lines) == 3

    # 왕복 충실성: data 는 int 리스트, extended/rtr 는 bool 로 복원
    restored = list(read_frames(path))
    assert len(restored) == 3
    for orig, got in zip(frames, restored):
        assert got.ts == orig.ts
        assert got.channel == orig.channel
        assert got.can_id == orig.can_id
        assert got.extended is orig.extended
        assert got.rtr is orig.rtr
        assert got.dlc == orig.dlc
        assert got.data == orig.data
        assert all(isinstance(b, int) for b in got.data)


def test_start_twice_closes_previous(tmp_path):
    p1 = str(tmp_path / "a.jsonl")
    p2 = str(tmp_path / "b.jsonl")
    rec = FrameRecorder()
    rec.start(p1)
    rec.record(_sample_frames()[:1])
    rec.start(p2)  # 이전 파일을 닫고 새로 연다
    assert rec.path == p2
    rec.stop()
    # 첫 파일은 기록된 1줄이 보존되어야 한다
    assert len(list(read_frames(p1))) == 1


def test_read_frames_skips_blank_lines(tmp_path):
    path = str(tmp_path / "log.jsonl")
    frame = _sample_frames()[0]
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(json.dumps(frame.to_dict()) + "\n")
        fp.write("\n")  # 빈 줄
        fp.write("   \n")  # 공백 줄
    assert len(list(read_frames(path))) == 1


def test_frame_from_dict_normalizes_types():
    d = {"ts": 1.0, "channel": 0, "can_id": 1, "extended": 1, "rtr": 0,
         "dlc": 2, "data": [1, 2]}
    frame = frame_from_dict(d)
    assert frame.extended is True
    assert frame.rtr is False
    assert frame.data == [1, 2]


def test_stop_when_not_logging_returns_none():
    assert FrameRecorder().stop() is None


# --- export_log: 표준 포맷 내보내기 ---

def _make_jsonl(tmp_path):
    """샘플 프레임을 JSONL 로 기록하고 경로 반환."""
    path = str(tmp_path / "src.jsonl")
    rec = FrameRecorder()
    rec.start(path)
    rec.record(_sample_frames())
    rec.stop()
    return path


def test_export_log_csv_roundtrip(tmp_path):
    src = _make_jsonl(tmp_path)
    dest = str(tmp_path / "out.csv")
    count = export_log(src, dest, "csv")
    assert count == 3

    with open(dest, encoding="utf-8", newline="") as fp:
        rows = list(csv.reader(fp))
    # 헤더 + 3행
    assert rows[0] == ["timestamp", "channel", "can_id", "extended",
                       "rtr", "dlc", "data"]
    assert len(rows) == 4

    # CSV 는 ts 까지 완전 왕복 가능(ASC 와 달리 절대 timestamp 보존)
    orig = _sample_frames()
    for row, frame in zip(rows[1:], orig):
        assert float(row[0]) == frame.ts
        assert int(row[1]) == frame.channel
        assert int(row[2], 16) == frame.can_id   # 0x 접두 hex
        assert bool(int(row[3])) == frame.extended
        assert bool(int(row[4])) == frame.rtr
        assert int(row[5]) == frame.dlc
        # data: 공백 구분 hex → 정수 리스트
        parsed = [int(b, 16) for b in row[6].split()] if row[6] else []
        assert parsed == frame.data


def test_export_log_asc_roundtrip(tmp_path):
    can = pytest.importorskip("can")  # python-can 의존성
    src = _make_jsonl(tmp_path)
    dest = str(tmp_path / "out.asc")
    count = export_log(src, dest, "asc")
    assert count == 3

    # 출력이 비어있지 않아야 한다
    with open(dest, encoding="utf-8") as fp:
        content = fp.read()
    assert content.strip()

    # can.ASCReader 로 재파싱: id/extended/rtr/dlc/data 보존 검증
    # (ASC 는 절대 timestamp 를 보존하지 않으므로 ts 동등성은 검증하지 않는다)
    msgs = list(can.ASCReader(dest))
    assert len(msgs) == 3
    orig = _sample_frames()
    for msg, frame in zip(msgs, orig):
        assert msg.arbitration_id == frame.can_id
        assert bool(msg.is_extended_id) == frame.extended
        assert bool(msg.is_remote_frame) == frame.rtr
        assert msg.dlc == frame.dlc
        if not frame.rtr:
            assert list(msg.data) == frame.data


def test_export_log_invalid_format_raises(tmp_path):
    src = _make_jsonl(tmp_path)
    dest = str(tmp_path / "out.blf")
    # blf 는 지원하지 않는다(ValueError)
    with pytest.raises(ValueError):
        export_log(src, dest, "blf")


def test_export_log_empty_source(tmp_path):
    # 빈 로그 → 0개 내보내기. CSV 는 헤더만 존재.
    src = str(tmp_path / "empty.jsonl")
    with open(src, "w", encoding="utf-8") as fp:
        fp.write("")
    dest = str(tmp_path / "out.csv")
    count = export_log(src, dest, "csv")
    assert count == 0
    with open(dest, encoding="utf-8", newline="") as fp:
        rows = list(csv.reader(fp))
    assert len(rows) == 1  # 헤더만
