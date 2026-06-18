"""CAN 프레임 파일 로깅·재생(replay).

- FrameRecorder: rx 프레임을 JSONL(한 줄=한 프레임)로 파일에 기록. write 마다 flush 하여
  크래시 시 유실을 최소화한다.
- read_frames(): 기록 파일을 읽어 CanFrame 으로 복원하는 제너레이터.

이 모듈은 **동기**로 유지한다. 비동기 replay 루프(타이밍 재현)는 server.py 가 구동하며,
이 모듈은 직렬화/역직렬화와 파일 I/O 만 담당한다(단위 테스트 용이성).
"""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import IO

from .protocol import CanFrame


class FrameRecorder:
    """rx 프레임을 JSONL 파일로 기록. start() → record() … → stop()."""

    def __init__(self) -> None:
        self._fp: IO[str] | None = None
        self._path: str | None = None

    @property
    def logging(self) -> bool:
        return self._fp is not None

    @property
    def path(self) -> str | None:
        return self._path

    def start(self, path: str) -> None:
        """path 에 새 로그 파일을 연다. 이미 기록 중이면 기존 파일을 먼저 닫는다."""
        if self._fp is not None:
            self.stop()
        # 한 줄=한 프레임 JSON. newline='' 로 OS별 개행 변환을 피한다.
        self._fp = open(path, "w", encoding="utf-8", newline="")
        self._path = path

    def record(self, frames: list[CanFrame]) -> None:
        """프레임 목록을 한 줄씩 기록. 기록 중이 아니면 무시."""
        if self._fp is None:
            return
        for frame in frames:
            self._fp.write(json.dumps(frame.to_dict()) + "\n")
        self._fp.flush()

    def stop(self) -> str | None:
        """기록을 종료하고 닫은 파일 경로를 반환. 기록 중이 아니면 None."""
        path = self._path
        if self._fp is not None:
            self._fp.close()
            self._fp = None
            self._path = None
        return path


def read_frames(path: str) -> Iterator[CanFrame]:
    """JSONL 로그 파일을 읽어 CanFrame 을 하나씩 yield. 빈 줄은 건너뛴다."""
    with open(path, "r", encoding="utf-8", newline="") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            yield frame_from_dict(json.loads(line))


def frame_from_dict(d: dict) -> CanFrame:
    """기록된 dict 를 CanFrame 으로 복원(JSONL 왕복용)."""
    return CanFrame(
        ts=d["ts"],
        channel=d["channel"],
        can_id=d["can_id"],
        extended=bool(d["extended"]),
        rtr=bool(d["rtr"]),
        dlc=d["dlc"],
        data=[int(b) for b in d["data"]],
    )
