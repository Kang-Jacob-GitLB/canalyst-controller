"""RxAggregator(순수 집계기) 단위 테스트."""
from canctl_core.aggregator import RxAggregator, frame_matches


def _f(ts, ch, cid, data, dir="rx", decoded=None):
    fr = {"ts": ts, "channel": ch, "can_id": cid, "extended": False,
          "rtr": False, "dlc": len(data), "data": data, "dir": dir}
    if decoded is not None:
        fr["decoded"] = decoded
    return fr


def test_counts_last_and_hex():
    agg = RxAggregator()
    agg.update(_f(1.0, 0, 0x100, [1, 2]))
    agg.update(_f(1.1, 0, 0x100, [3, 4]))
    agg.update(_f(1.0, 0, 0x200, [9]))
    snap = {i["can_id"]: i for i in agg.snapshot()}
    assert snap[0x100]["count"] == 2
    assert snap[0x100]["data"] == [3, 4]      # 최신값
    assert snap[0x100]["can_id_hex"] == "0x100"
    assert snap[0x200]["count"] == 1


def test_rate_estimate():
    agg = RxAggregator()
    for i in range(11):
        agg.update(_f(i * 0.05, 0, 0x100, [i & 0xFF]))  # 0.05s 간격 = 20Hz
    assert abs(agg.snapshot()[0]["rate_hz"] - 20.0) < 0.5


def test_filter_ids_channel_dir():
    agg = RxAggregator()
    agg.update(_f(1, 0, 0x100, [1]))
    agg.update(_f(1, 1, 0x200, [2]))
    agg.update(_f(1, 0, 0x300, [3], dir="tx"))
    assert [i["can_id"] for i in agg.snapshot(ids=[0x100])] == [0x100]
    assert [i["can_id"] for i in agg.snapshot(channel=1)] == [0x200]
    # dir 기본 'rx' → tx(0x300) 제외
    assert 0x300 not in [i["can_id"] for i in agg.snapshot()]
    assert [i["can_id"] for i in agg.snapshot(dir="tx")] == [0x300]
    # snapshot 은 (channel, can_id) 로 정렬: (0,0x100),(0,0x300),(1,0x200)
    assert [i["can_id"] for i in agg.snapshot(dir=None)] == [0x100, 0x300, 0x200]


def test_stats_and_clear():
    agg = RxAggregator()
    agg.update(_f(1, 0, 0x100, [1]))
    agg.update(_f(1, 0, 0x200, [2]))
    st = agg.stats()
    assert st["total_frames"] == 2 and st["distinct_ids"] == 2
    agg.clear()
    assert agg.stats()["total_frames"] == 0 and agg.snapshot() == []


def test_decoded_attached():
    agg = RxAggregator()
    agg.update(_f(1, 0, 0x100, [1], decoded={"message": "M", "signals": {"s": 1}}))
    assert agg.snapshot()[0]["decoded"]["message"] == "M"


def test_frame_matches():
    fr = _f(1, 0, 0x100, [0xAA, 0xBB], dir="rx")
    assert frame_matches(fr, can_id=0x100)
    assert not frame_matches(fr, can_id=0x101)
    assert frame_matches(fr, channel=0, data_prefix=[0xAA])
    assert not frame_matches(fr, data_prefix=[0xAB])
    assert not frame_matches(fr, dir="tx")
    assert frame_matches(fr)  # 조건 없음 = 통과
