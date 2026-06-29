"""asyncio WebSocket 서버.

- 백그라운드 폴링 루프가 backend.poll() 로 프레임을 모아 모든 클라이언트에 rx 배칭 broadcast.
- 클라이언트 명령(list_devices/connect/disconnect/send)을 받아 백엔드에 위임하고 결과를 회신.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import threading
import time

import websockets

from . import protocol
from .backend import CanBackend
from .dbc import DbcDecoder, DbcUnavailable
from .protocol import CanFrame, ProtocolError
from .recorder import FrameRecorder, export_log, read_frames_any

log = logging.getLogger("canctl_core.server")

#: replay 시 프레임 간 최대 대기(초). 기록 간격이 크더라도 이 값으로 캡.
REPLAY_MAX_GAP = 1.0


class CanServer:
    def __init__(self, backend: CanBackend, host: str = "127.0.0.1",
                 port: int = 8765, poll_interval: float = 0.05) -> None:
        self._backend = backend
        self._host = host
        self._port = port
        self._poll_interval = poll_interval
        self._clients: set = set()
        self._running = False
        # 기능 확장 상태
        self._filter_ids: set[int] = set()     # 전역 수신 필터(빈 set 이면 id 전체 통과)
        self._filter_mask: int | None = None    # None=all-ones(정확 일치), int=마스크 매칭
        self._filter_channel: int | None = None  # None=전체 채널, int=해당 채널만
        self._recorder = FrameRecorder()        # rx 파일 로깅
        self._decoder = DbcDecoder()            # DBC 신호 디코딩
        self._replay_task: asyncio.Task | None = None  # 진행 중인 replay
        self._stop: asyncio.Event | None = None  # 종료 트리거(run_forever 안에서 생성)
        # 주기 송신: id → {"task": asyncio.Task, "meta": dict}. seq 는 id 발급용.
        self._periodics: dict[int, dict] = {}
        self._periodic_seq = 0

    async def run_forever(self) -> None:
        self._running = True
        loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        # 부모(Electron)가 종료/크래시하면 stdin 이 EOF 가 되고, 그때 graceful
        # 종료해 장비 연결을 해제하고 프로세스가 orphan 으로 남지 않게 한다.
        # SIGINT/SIGTERM(개발 터미널 Ctrl-C 등)도 같은 stop 으로 수렴시킨다.
        self._install_signal_handlers(loop)
        self._start_stdin_watcher(loop)
        poll_task = asyncio.create_task(self._broadcast_loop())
        try:
            async with websockets.serve(self._handler, self._host, self._port):
                log.info("WebSocket 서버 시작: ws://%s:%d (backend=%s)",
                         self._host, self._port, self._backend.name)
                await self._stop.wait()  # 종료 신호(stop)까지 대기
        finally:
            self._running = False
            poll_task.cancel()
            if self._replay_task is not None:
                self._replay_task.cancel()
            # 진행 중인 주기 송신 태스크를 모두 취소(종료 중이므로 통지는 생략).
            for entry in self._periodics.values():
                entry["task"].cancel()
            self._periodics.clear()
            self._recorder.stop()  # 열려있던 로그 파일 확실히 닫기
            # 장비 연결을 확실히 해제(USB/버스 핸들 반환). mock·canalystii 공통.
            try:
                self._backend.disconnect()
            except Exception:
                log.exception("종료 중 백엔드 disconnect 실패")

    def _install_signal_handlers(self, loop: asyncio.AbstractEventLoop) -> None:
        """SIGINT/SIGTERM 을 stop 트리거로 연결한다.

        Windows 의 asyncio 루프는 add_signal_handler 를 지원하지 않으므로
        (NotImplementedError) signal.signal 로 폴백한다. signal.signal 은
        메인 스레드에서만 등록 가능하며 run_forever 는 메인 스레드에서 돈다.
        """
        def trigger() -> None:
            if self._stop is not None:
                self._stop.set()

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, trigger)
            except (NotImplementedError, RuntimeError, ValueError, AttributeError):
                try:
                    signal.signal(sig, lambda *_: loop.call_soon_threadsafe(trigger))
                except (ValueError, OSError):
                    pass  # 등록 불가 환경(서브스레드 등)은 stdin EOF 에 의존

    def _start_stdin_watcher(self, loop: asyncio.AbstractEventLoop) -> None:
        """stdin 을 블로킹 읽기로 감시하다 EOF 면 stop 을 트리거한다.

        Electron 이 사이드카 stdin 을 pipe 로 열어 두므로, 부모가 stdin.end()
        하거나 부모 프로세스가 사라지면(정상 종료·크래시·HMR 재시작) read 가
        EOF(b"") 를 돌려준다 → 코어가 스스로 graceful 종료한다. 플랫폼/시그널
        과 무관하게 동작하는 가장 견고한 종료 경로다.

        구현 주의 — 반드시 ``os.read(fd)`` 로 저수준 읽기를 한다. ``sys.stdin``
        (BufferedReader)의 ``read`` 는 버퍼 락을 쥔 채 블로킹되는데, 이 데몬
        스레드가 락을 쥔 상태로 인터프리터가 finalize 되면
        ``Fatal Python error: _enter_buffered_busy``(Windows 0xC0000005)로
        죽는다. stdin EOF 가 아닌 경로(bind 실패·SIGINT/SIGTERM 등)로 종료될
        때마다 재현된다. ``os.read`` 는 그 파이썬 레벨 버퍼 락을 거치지 않아
        finalize 가 락을 자유롭게 회수할 수 있어 안전하다.
        """
        try:
            fd = sys.stdin.fileno()
        except (AttributeError, ValueError, OSError):
            return  # stdin 이 없는 환경(예: 완전 분리 실행)은 시그널에 의존

        # 터미널에서 직접 실행한 경우(tty)엔 부모가 닫아 줄 pipe 가 없어 감시가
        # 무의미할 뿐 아니라 사용자 키보드 입력을 가로챈다. Electron 이 넘겨준
        # pipe(=非tty)일 때만 EOF 를 감시한다.
        try:
            if os.isatty(fd):
                return
        except OSError:
            pass

        def watch() -> None:
            try:
                while True:
                    if os.read(fd, 1) == b"":
                        break  # EOF → 부모 종료
            except OSError:
                pass  # 파이프 오류 등도 종료로 간주
            loop.call_soon_threadsafe(
                lambda: self._stop.set() if self._stop is not None else None)

        threading.Thread(target=watch, daemon=True, name="stdin-eof-watch").start()

    async def _handler(self, ws) -> None:
        self._clients.add(ws)
        log.info("클라이언트 연결 (총 %d)", len(self._clients))
        try:
            await ws.send(self._status_msg())  # 연결 직후 현재 상태 통지
            async for raw in ws:
                await self._handle_command(ws, raw)
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            log.info("클라이언트 해제 (총 %d)", len(self._clients))

    async def _handle_command(self, ws, raw) -> None:
        try:
            msg = protocol.parse_command(raw)
        except ProtocolError as exc:
            await ws.send(protocol.make_error(str(exc)))
            return

        cmd = msg["type"]
        try:
            if cmd == "list_devices":
                await ws.send(protocol.make_devices(self._backend.list_devices()))
            elif cmd == "connect":
                # 재연결 시 이전 연결에 묶인 주기 송신을 정리(stale TX 방지).
                await self._stop_periodics()
                # bitrate1 생략 시 None → 백엔드가 bitrate 와 동일하게 처리(하위호환).
                self._backend.connect(msg["device_index"], msg["channel"],
                                      msg["bitrate"], msg.get("bitrate1"))
                await self._broadcast(self._status_msg())
            elif cmd == "disconnect":
                self._backend.disconnect()
                # 진행 중인 주기 송신을 모두 중지(끊긴 장비로 송신하지 않게)
                await self._stop_periodics()
                # 진행 중인 로깅·replay 를 정리(끊긴 후 빈 파일이 계속 열려 있지 않게)
                if self._recorder.logging:
                    path = self._recorder.stop()
                    await self._broadcast(protocol.make_log_status(False, path))
                if self._replay_task is not None and not self._replay_task.done():
                    self._replay_task.cancel()
                await self._broadcast(self._status_msg())
            elif cmd == "send":
                self._backend.send(msg["channel"], msg["can_id"],
                                   msg["extended"], msg["rtr"], msg["data"])
                # 송신 프레임을 tx 로 모니터에 echo(필터 무관, 항상 표시)
                tx = CanFrame(
                    ts=time.time(), channel=msg["channel"], can_id=msg["can_id"],
                    extended=msg["extended"], rtr=msg["rtr"],
                    dlc=len(msg["data"]), data=list(msg["data"]), dir="tx",
                )
                await self._broadcast(protocol.make_rx([tx], decoder=self._decoder))
            elif cmd == "set_filter":
                self._filter_ids = set(msg["ids"])
                # mask/channel 은 optional. 키가 있으면 갱신, 없으면 기존 값 유지하지
                # 않고 기본값으로 재설정(set_filter 는 필터 전체를 교체하는 의미).
                self._filter_mask = msg["mask"] if "mask" in msg else None
                self._filter_channel = msg["channel"] if "channel" in msg else None
                await self._broadcast(protocol.make_filter(
                    sorted(self._filter_ids),
                    mask=self._filter_mask,
                    channel=self._filter_channel,
                ))
            elif cmd == "start_log":
                self._recorder.start(msg["path"])
                await self._broadcast(protocol.make_log_status(True, self._recorder.path))
            elif cmd == "stop_log":
                path = self._recorder.stop()
                await self._broadcast(protocol.make_log_status(False, path))
            elif cmd == "replay":
                self._start_replay(msg["path"])
            elif cmd == "stop_replay":
                # 진행 중인 replay 취소. 종료 통지(replay_status False)는 _replay_loop 의
                # finally 한 곳에서 보낸다(취소·자연종료·에러 공통) — 여기선 취소만 건다.
                if self._replay_task is not None and not self._replay_task.done():
                    self._replay_task.cancel()
            elif cmd == "load_dbc":
                self._decoder.load(msg["path"])
                log.info("DBC 로드 완료: %s", msg["path"])
            elif cmd == "list_dbc_messages":
                if not self._decoder.loaded:
                    await ws.send(protocol.make_error(
                        "DBC가 로드되지 않았습니다. 먼저 DBC를 로드하세요"))
                else:
                    # 요청자에게만 메시지 목록을 회신(broadcast 아님)
                    await ws.send(protocol.make_dbc_messages(
                        self._decoder.list_messages()))
            elif cmd == "encode_send":
                if not self._decoder.loaded:
                    await ws.send(protocol.make_error(
                        "DBC가 로드되지 않았습니다. 먼저 DBC를 로드하세요"))
                else:
                    # 신호 dict 를 인코딩 → 백엔드 송신 → tx 프레임을 모니터에 echo
                    frame_id, is_extended, data = self._decoder.encode(
                        msg["message"], msg["signals"])
                    self._backend.send(msg["channel"], frame_id, is_extended, False, data)
                    tx = CanFrame(
                        ts=time.time(), channel=msg["channel"], can_id=frame_id,
                        extended=is_extended, rtr=False,
                        dlc=len(data), data=list(data), dir="tx",
                    )
                    await self._broadcast(protocol.make_rx([tx], decoder=self._decoder))
            elif cmd == "export_log":
                # JSONL 로그를 표준 포맷(asc/csv/blf)으로 내보내고 요청자에게만 결과 회신.
                count = export_log(msg["src"], msg["dest"], msg["format"])
                await ws.send(protocol.make_export_status(
                    ok=True, path=msg["dest"], count=count, format=msg["format"]))
            elif cmd == "send_periodic":
                # 주기 송신 태스크를 등록하고 현재 목록을 통지.
                self._start_periodic(msg)
                await self._broadcast(self._periodic_status_msg())
            elif cmd == "stop_periodic":
                # id 지정 시 그 태스크만, 생략 시 전체 중지.
                await self._stop_periodics(msg.get("id"))
        except DbcUnavailable as exc:  # cantools 미설치 등은 안내성 error
            await ws.send(protocol.make_error(str(exc)))
        except Exception as exc:  # 백엔드 오류를 클라이언트로 표면화
            log.exception("명령 처리 오류: %s", cmd)
            await ws.send(protocol.make_error(f"{cmd} 실패: {exc}"))

    def _status_msg(self) -> str:
        return protocol.make_status(
            connected=self._backend.connected,
            backend=self._backend.name,
            device=self._backend.device_info,
            channels=self._backend.channels,
        )

    async def _broadcast_loop(self) -> None:
        try:
            while self._running:
                frames = self._backend.poll()
                if frames:
                    # 라이브 프레임만 기록(replay 프레임은 재기록하지 않는다)
                    self._recorder.record(frames)
                    passed = self._apply_filter(frames)
                    if passed and self._clients:
                        await self._broadcast(self._rx_msg(passed))
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            pass

    def _apply_filter(self, frames: list) -> list:
        """전역 수신 필터(채널 + 마스크/ID)를 적용해 통과 프레임만 반환.

        - channel: None 이 아니면 frame.channel == channel 인 것만 통과.
        - ids: 비면 (id 기준) 전체 통과. 아니면 마스크 적용 후 집합 매칭
          (frame.can_id & mask) in {(i & mask) for i in ids}.
        - mask: None 이면 all-ones(정확 일치). mask=0 이면 모든 id 매칭(예외 없음).
        - channel 과 id 조건은 AND.
        """
        # truthiness 가 아닌 is not None 으로 분기(channel=0, mask=0 이 유효값).
        chan = self._filter_channel
        if self._filter_ids:
            mask = self._filter_mask if self._filter_mask is not None else 0xFFFFFFFF
            allowed = {(i & mask) for i in self._filter_ids}
        else:
            mask = None  # id 필터 없음 → 마스크도 의미 없음

        out = []
        for f in frames:
            if chan is not None and f.channel != chan:
                continue
            if mask is not None and (f.can_id & mask) not in allowed:
                continue
            out.append(f)
        return out

    def _rx_msg(self, frames: list) -> str:
        """필터를 통과한 프레임에 DBC 디코더(로드 시)를 부착한 rx 메시지 생성."""
        return protocol.make_rx(frames, decoder=self._decoder)

    def _start_replay(self, path: str) -> None:
        """기존 replay 가 진행 중이면 취소하고 새 replay task 를 시작."""
        if self._replay_task is not None and not self._replay_task.done():
            self._replay_task.cancel()
        self._replay_task = asyncio.create_task(self._replay_loop(path))

    async def _replay_loop(self, path: str) -> None:
        """기록 파일을 읽어 ts 델타를 재현하며 rx 스트림으로 흘려보낸다(재기록 안 함).

        우리 JSONL 뿐 아니라 외부 표준 로그(asc/blf/trc/mf4)도 확장자로 인식해 재생한다.
        시작 시 replay_status(True), 종료(자연·중지·취소·에러) 시 finally 에서 한 곳으로
        replay_status(False) 를 통지한다. 취소(CancelledError)는 삼켜 finally 통지가
        반드시 실행되게 한다(중지/연결해제 시 UI 가 '재생 중'에 멈춰 있지 않도록).
        """
        await self._broadcast(protocol.make_replay_status(True, path))
        try:
            prev_ts: float | None = None
            for frame in read_frames_any(path):
                if prev_ts is not None:
                    gap = frame.ts - prev_ts
                    if gap > 0:
                        await asyncio.sleep(min(gap, REPLAY_MAX_GAP))
                prev_ts = frame.ts
                passed = self._apply_filter([frame])
                if passed and self._clients:
                    await self._broadcast(self._rx_msg(passed))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.exception("replay 오류: %s", path)
            await self._broadcast(protocol.make_error(f"replay 실패: {exc}"))
        finally:
            await self._broadcast(protocol.make_replay_status(False, path))

    # --- 주기 송신(send_periodic / stop_periodic) ---

    def _start_periodic(self, msg: dict) -> int:
        """주기 송신 메타를 등록하고 백그라운드 태스크를 시작. 발급한 id 반환."""
        self._periodic_seq += 1
        pid = self._periodic_seq
        meta = {
            "channel": msg["channel"], "can_id": msg["can_id"],
            "extended": msg["extended"], "rtr": msg["rtr"],
            "data": list(msg["data"]), "period": msg["period"],
            "count": msg.get("count"),  # None=무한
            "sent": 0,
        }
        task = asyncio.create_task(self._periodic_loop(pid))
        self._periodics[pid] = {"task": task, "meta": meta}
        return pid

    async def _periodic_loop(self, pid: int) -> None:
        """등록된 주기 송신을 period 간격으로 보낸다. count 도달/취소/에러 시 종료.

        - 즉시 1회 송신 후 period 간격(드리프트 보정: 송신 지연을 다음 주기에서 흡수).
        - 각 송신은 tx 프레임으로 모니터에 echo(일반 send 와 동일).
        - 취소(stop_periodic/disconnect)는 취소자가 dict 정리·통지를 담당하므로 즉시 반환.
        - 자연 종료(count 완료/에러)는 스스로 dict 에서 빠지고 periodic_status 를 통지.
        """
        entry = self._periodics.get(pid)
        if entry is None:
            return
        meta = entry["meta"]
        loop = asyncio.get_running_loop()
        next_at = loop.time()
        try:
            while meta["count"] is None or meta["sent"] < meta["count"]:
                try:
                    self._backend.send(meta["channel"], meta["can_id"],
                                       meta["extended"], meta["rtr"], meta["data"])
                except Exception as exc:
                    await self._broadcast(protocol.make_error(
                        f"send_periodic 실패: {exc}"))
                    break
                tx = CanFrame(
                    ts=time.time(), channel=meta["channel"], can_id=meta["can_id"],
                    extended=meta["extended"], rtr=meta["rtr"],
                    dlc=len(meta["data"]), data=list(meta["data"]), dir="tx",
                )
                await self._broadcast(protocol.make_rx([tx], decoder=self._decoder))
                meta["sent"] += 1
                if meta["count"] is not None and meta["sent"] >= meta["count"]:
                    break
                # 다음 발사 시각까지 대기(송신·echo 에 든 시간을 흡수해 드리프트 방지).
                next_at += meta["period"]
                delay = next_at - loop.time()
                await asyncio.sleep(delay if delay > 0 else 0)
        except asyncio.CancelledError:
            return  # 취소자가 정리·통지 담당
        # 자연 종료: 스스로 정리하고 현재 목록을 통지.
        self._periodics.pop(pid, None)
        await self._broadcast(self._periodic_status_msg())

    async def _stop_periodics(self, pid: int | None = None) -> None:
        """주기 송신 중지. pid 지정 시 해당 태스크만, 생략 시 전체. 목록을 통지.

        대상이 없거나 dict 가 비어도 안전하게 동작한다(idempotent).
        """
        if pid is not None:
            targets = [pid]
        else:
            targets = list(self._periodics.keys())
        for t in targets:
            entry = self._periodics.pop(t, None)
            if entry is not None:
                entry["task"].cancel()
        await self._broadcast(self._periodic_status_msg())

    def _periodic_status_msg(self) -> str:
        """진행 중인 주기 송신 목록을 periodic_status 메시지로 직렬화."""
        tasks = []
        for pid, entry in sorted(self._periodics.items()):
            m = entry["meta"]
            tasks.append({
                "id": pid, "channel": m["channel"], "can_id": m["can_id"],
                "extended": m["extended"], "rtr": m["rtr"], "data": list(m["data"]),
                "period": m["period"], "count": m["count"], "sent": m["sent"],
            })
        return protocol.make_periodic_status(tasks)

    async def _broadcast(self, msg: str) -> None:
        if not self._clients:
            return
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send(msg)
            except websockets.ConnectionClosed:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)
