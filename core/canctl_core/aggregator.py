"""rx 프레임 통계 집계 유틸(순수 — 외부 의존성 없음). **core 분석 계층용.**

라이브 MCP 어댑터는 이걸 쓰지 않는다(MCP 는 라이브 동작만 하고 분석은 안 함 — 거기서
쓰는 건 `frame_matches` 뿐). `RxAggregator` 는 캡처 파일을 (channel, can_id)별로 집계해
요약/통계를 내는 **CLI(배치 분석)용 core 유틸**이다. 단일 코어에 한 번만 두고 어댑터에서
중복 구현하지 않기 위해 여기 둔다.

`update()` 는 동기로 유지한다(스트림 처리 중 await 로 멈추지 않게)."""
from __future__ import annotations

from collections import deque
from typing import Any


def frame_matches(frame: dict, *, can_id: int | None = None,
                  channel: int | None = None, dir: str | None = None,
                  data_prefix: list[int] | None = None) -> bool:
    """wait_for 용 프레임 매칭 술어. 지정한 조건만 AND 로 검사(미지정은 통과)."""
    if can_id is not None and frame.get("can_id") != can_id:
        return False
    if channel is not None and frame.get("channel") != channel:
        return False
    if dir is not None and frame.get("dir", "rx") != dir:
        return False
    if data_prefix is not None:
        data = frame.get("data", [])
        prefix = list(data_prefix)
        if len(data) < len(prefix) or data[:len(prefix)] != prefix:
            return False
    return True


class RxAggregator:
    """(channel, can_id)별 최신값·횟수·레이트·디코딩을 유지하는 롤링 집계기."""

    def __init__(self, max_recent: int = 64) -> None:
        # 레이트 추정용으로 보관할 최근 타임스탬프 개수(키별). 클수록 평활.
        self._max_recent = max_recent
        self._keys: dict[tuple[int, int], dict[str, Any]] = {}
        self._total = 0

    def update(self, frame: dict) -> None:
        """단일 rx/tx 프레임으로 상태 갱신(동기, 비차단)."""
        self._total += 1
        key = (frame["channel"], frame["can_id"])
        entry = self._keys.get(key)
        if entry is None:
            entry = {
                "channel": frame["channel"], "can_id": frame["can_id"],
                "count": 0, "ts": deque(maxlen=self._max_recent),
                "last": [], "dir": "rx", "extended": False, "rtr": False,
                "decoded": None,
            }
            self._keys[key] = entry
        entry["count"] += 1
        entry["ts"].append(frame.get("ts", 0.0))
        entry["last"] = list(frame.get("data", []))
        entry["dir"] = frame.get("dir", "rx")
        entry["extended"] = frame.get("extended", False)
        entry["rtr"] = frame.get("rtr", False)
        if frame.get("decoded") is not None:
            entry["decoded"] = frame["decoded"]

    @staticmethod
    def _rate_hz(ts: deque) -> float:
        """보관된 최근 타임스탬프로부터 평균 레이트(Hz) 추정."""
        if len(ts) < 2:
            return 0.0
        span = ts[-1] - ts[0]
        if span <= 0:
            return 0.0
        return (len(ts) - 1) / span

    def snapshot(self, ids: list[int] | None = None,
                 channel: int | None = None,
                 dir: str | None = "rx") -> list[dict]:
        """키별 요약 목록. ids/channel/dir 로 필터(미지정은 전체)."""
        idset = set(ids) if ids else None
        out: list[dict] = []
        for (ch, cid), e in sorted(self._keys.items()):
            if idset is not None and cid not in idset:
                continue
            if channel is not None and ch != channel:
                continue
            if dir is not None and e["dir"] != dir:
                continue
            item = {
                "channel": ch,
                "can_id": cid,
                "can_id_hex": hex(cid),
                "dir": e["dir"],
                "count": e["count"],
                "rate_hz": round(self._rate_hz(e["ts"]), 2),
                "last_ts": e["ts"][-1] if e["ts"] else None,
                "data": list(e["last"]),
                "extended": e["extended"],
                "rtr": e["rtr"],
            }
            if e["decoded"] is not None:
                item["decoded"] = e["decoded"]
            out.append(item)
        return out

    def stats(self, ids: list[int] | None = None,
              channel: int | None = None,
              dir: str | None = "rx") -> dict:
        """전체 누계 + 키별 요약. total_frames 는 dir/필터와 무관한 총 관측 수."""
        snap = self.snapshot(ids=ids, channel=channel, dir=dir)
        return {
            "total_frames": self._total,
            "distinct_ids": len(snap),
            "ids": snap,
        }

    def clear(self) -> None:
        """누적 상태 초기화."""
        self._keys.clear()
        self._total = 0
