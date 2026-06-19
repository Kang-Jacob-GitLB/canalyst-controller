"""CAN 프레임 파일 로깅·재생(replay)·표준 포맷 내보내기.

- FrameRecorder: rx 프레임을 JSONL(한 줄=한 프레임)로 파일에 기록. write 마다 flush 하여
  크래시 시 유실을 최소화한다.
- read_frames(): 기록 파일을 읽어 CanFrame 으로 복원하는 제너레이터.
- export_log(): JSONL 로그를 candump 스타일 CSV 또는 Vector ASC(python-can ASCWriter)로 변환.

이 모듈은 **동기**로 유지한다. 비동기 replay 루프(타이밍 재현)는 server.py 가 구동하며,
이 모듈은 직렬화/역직렬화와 파일 I/O 만 담당한다(단위 테스트 용이성).
"""
from __future__ import annotations

import csv
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


#: CSV 내보내기 헤더(candump 스타일).
_CSV_HEADER = ["timestamp", "channel", "can_id", "extended", "rtr", "dlc", "data"]


def export_log(src: str, dest: str, format: str) -> int:
    """JSONL 로그(src)를 표준 포맷(dest)으로 내보내고 내보낸 프레임 수를 반환.

    - format="csv": candump 스타일 CSV. 헤더 + 행(timestamp, channel,
      can_id(hex), extended, rtr, dlc, data(공백 구분 hex)).
    - format="asc": python-can can.ASCWriter 로 Vector ASC 작성.

    지원하지 않는 format 은 ValueError. src 미존재 등 I/O 오류는 그대로 전파한다.
    """
    if format == "csv":
        return _export_csv(src, dest)
    if format == "asc":
        return _export_asc(src, dest)
    raise ValueError(f"지원하지 않는 export 포맷: {format!r}")


def _export_csv(src: str, dest: str) -> int:
    """candump 스타일 CSV 로 내보낸다. data 는 공백 구분 2자리 hex."""
    count = 0
    # newline='' 는 csv 모듈 권장(중복 개행 방지).
    with open(dest, "w", encoding="utf-8", newline="") as fp:
        writer = csv.writer(fp)
        writer.writerow(_CSV_HEADER)
        for frame in read_frames(src):
            writer.writerow([
                frame.ts,
                frame.channel,
                # can_id 는 0x 접두 hex 로 가독성·왕복 모두 확보
                f"0x{frame.can_id:X}",
                int(frame.extended),
                int(frame.rtr),
                frame.dlc,
                " ".join(f"{b:02X}" for b in frame.data),
            ])
            count += 1
    return count


def _export_asc(src: str, dest: str) -> int:
    """python-can can.ASCWriter 로 Vector ASC 로 내보낸다.

    각 CanFrame → can.Message 변환 후 writer.on_message_received(msg).
    with 구문으로 writer 를 닫는다(내부적으로 stop() 호출).
    """
    # can 은 ASC 경로에서만 필요하므로 지연 import(미설치 환경에서 csv 경로는 동작).
    import can

    count = 0
    with can.ASCWriter(dest) as writer:
        for frame in read_frames(src):
            msg = can.Message(
                timestamp=frame.ts,
                arbitration_id=frame.can_id,
                is_extended_id=frame.extended,
                is_remote_frame=frame.rtr,
                dlc=frame.dlc,
                # rtr 프레임은 데이터가 없으므로 빈 bytes
                data=bytes(frame.data) if not frame.rtr else b"",
                channel=frame.channel,
            )
            writer.on_message_received(msg)
            count += 1
    return count
