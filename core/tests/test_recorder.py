"""FrameRecorder 기록·JSONL 왕복·read_frames 테스트."""
import json

from canctl_core.protocol import CanFrame
from canctl_core.recorder import FrameRecorder, frame_from_dict, read_frames


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
