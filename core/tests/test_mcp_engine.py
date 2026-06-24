"""CanctlEngine(라이브 세션 어댑터) 테스트.

실제 WS 대신 FakeConn 을 주입해 reader 의 라우팅(request 응답/error/wait_for/stream/
상태 추적)을 검증한다. _connect_impl 을 오버라이드하므로 autospawn 은 발동하지 않는다.
mcp SDK 불필요(build_app 만 lazy import). asyncio.run 으로 구동.
"""
import asyncio
import json

import pytest

from canctl_core.mcp_server import CanctlEngine, EngineError


class FakeConn:
    def __init__(self):
        self.sent = []
        self._q = asyncio.Queue()
        self.closed = False

    async def send(self, msg):
        self.sent.append(json.loads(msg))

    def feed(self, obj):
        self._q.put_nowait(json.dumps(obj))

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._q.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def close(self):
        self.closed = True


class FakeEngine(CanctlEngine):
    def __init__(self):
        super().__init__(url="ws://fake", timeout=1.0, autospawn=False)
        self.fake = FakeConn()

    async def _connect_impl(self):
        return self.fake


def _rx(frames):
    return {"type": "rx", "frames": frames}


def _frame(cid, data, ch=0, dir="rx", ts=1.0):
    return {"ts": ts, "channel": ch, "can_id": cid, "extended": False,
            "rtr": False, "dlc": len(data), "data": data, "dir": dir}


def test_request_returns_matching_response():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()

        async def responder():
            await asyncio.sleep(0.01)
            eng.fake.feed({"type": "devices", "list": [{"index": 0}]})
        asyncio.create_task(responder())

        res = await eng.request({"type": "list_devices"},
                                lambda m: m.get("type") == "devices")
        assert res["list"][0]["index"] == 0
        await eng.aclose()
    asyncio.run(t())


def test_request_error_raises():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()

        async def responder():
            await asyncio.sleep(0.01)
            eng.fake.feed({"type": "error", "message": "연결 실패함"})
        asyncio.create_task(responder())

        with pytest.raises(EngineError) as ei:
            await eng.request(
                {"type": "connect", "device_index": 0, "channel": 0, "bitrate": 1},
                lambda m: m.get("type") == "status" and m.get("connected"))
        assert "연결 실패함" in str(ei.value)
        await eng.aclose()
    asyncio.run(t())


def test_request_timeout_raises():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()
        with pytest.raises(EngineError) as ei:
            await eng.request({"type": "list_devices"},
                              lambda m: m.get("type") == "devices", timeout=0.1)
        assert "시간 초과" in str(ei.value)
        await eng.aclose()
    asyncio.run(t())


def test_wait_for_matches_then_timeout():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()

        async def feeder():
            await asyncio.sleep(0.01)
            eng.fake.feed(_rx([_frame(0x200, [9])]))
        asyncio.create_task(feeder())

        fr = await eng.wait_for(lambda f: f["can_id"] == 0x200, timeout=1.0)
        assert fr is not None and fr["can_id"] == 0x200

        none = await eng.wait_for(lambda f: f["can_id"] == 0x999, timeout=0.1)
        assert none is None
        await eng.aclose()
    asyncio.run(t())


def test_stream_collects_bounded_by_duration():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()

        async def feeder():
            for i in range(5):
                await asyncio.sleep(0.02)
                eng.fake.feed(_rx([_frame(0x100, [i])]))
        asyncio.create_task(feeder())

        frames = await eng.stream(duration=0.3, count=None, ids=None, channel=None)
        assert len(frames) >= 1
        assert all(f["can_id"] == 0x100 for f in frames)
        await eng.aclose()
    asyncio.run(t())


def test_stream_count_early_stop_and_id_filter():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()

        async def feeder():
            for i in range(20):
                await asyncio.sleep(0.01)
                eng.fake.feed(_rx([_frame(0x100, [i]), _frame(0x200, [i])]))
        asyncio.create_task(feeder())

        frames = await eng.stream(duration=5.0, count=2, ids=[0x100], channel=None)
        assert len(frames) == 2
        assert all(f["can_id"] == 0x100 for f in frames)
        await eng.aclose()
    asyncio.run(t())


def test_status_reports_filter_and_capture():
    async def t():
        eng = FakeEngine()
        await eng.ensure_connected()
        eng.fake.feed({"type": "status", "connected": True, "backend": "mock",
                       "device": {"index": 0, "bitrate": 500000}, "channels": [0, 1]})
        eng.fake.feed({"type": "filter", "ids": [256], "mask": 4294967295,
                       "channel": None})
        eng.fake.feed({"type": "log_status", "logging": True, "path": "/x/cap.jsonl"})
        await asyncio.sleep(0.05)
        st = await eng.status()
        assert st["connected"] is True
        assert st["ws_connected"] is True
        assert st["server_filter"]["ids"] == [256]
        assert st["capturing"] is True and st["capture_path"] == "/x/cap.jsonl"
        await eng.aclose()
    asyncio.run(t())


def test_connect_drains_initial_status_no_stale():
    # 이미 연결된 데몬에 처음 붙는 상황을 모사: 연결 직후 status(옛 bitrate 500000).
    # ensure_connected 의 드레인이 이를 _latest_status 로 소비해야, 이후 재연결 request 가
    # 그 '낡은' status 로 조기 반환되지 않고 새 status(250000)를 기다린다.
    async def t():
        eng = FakeEngine()
        eng.fake.feed({"type": "status", "connected": True, "backend": "mock",
                       "device": {"index": 0, "bitrate": 500000}, "channels": [0, 1]})
        await eng.ensure_connected()
        assert eng._latest_status["device"]["bitrate"] == 500000  # 초기 status 드레인됨

        async def responder():
            await asyncio.sleep(0.02)
            eng.fake.feed({"type": "status", "connected": True, "backend": "mock",
                           "device": {"index": 0, "bitrate": 250000}, "channels": [0, 1]})
        asyncio.create_task(responder())

        res = await eng.request(
            {"type": "connect", "device_index": 0, "channel": 0, "bitrate": 250000},
            lambda m: m.get("type") == "status" and m.get("connected") is True)
        assert res["device"]["bitrate"] == 250000  # 낡은 500000 이 아니라 새 값
        await eng.aclose()
    asyncio.run(t())


def test_ensure_connected_unreachable_no_autospawn():
    async def t():
        eng = CanctlEngine(url="ws://127.0.0.1:1", timeout=0.5, autospawn=False)
        with pytest.raises(EngineError) as ei:
            await eng.ensure_connected()
        assert "데몬" in str(ei.value)
    asyncio.run(t())
