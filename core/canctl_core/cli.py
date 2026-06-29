"""canctl — CANalyst-II 제어 코어용 명령줄 클라이언트(AI/스크립트 친화).

실행 중인 코어 데몬(`python -m canctl_core [--mock]`)에 WebSocket 으로 붙어
프로토콜 명령을 한 번 보내고 그 결과를 **JSON 으로 stdout 에 출력**한 뒤 종료한다.
Electron UI 와 동일한 WS 프로토콜을 쓰므로 UI 와 동시에 사용해도 된다(서버가
단일 상태원이다). CAN 장치 연결은 본질적으로 상태를 가지므로(connect 후 send),
한 번씩 붙었다 떨어지는 CLI 가 같은 데몬에 명령을 위임하는 구조다.

설계 원칙 — "AI 가 쓴다 = 어떤 명령도 무한 대기하면 안 된다":
- `monitor` 는 항상 `--duration`/`--count` 로 유한하다(기본 5초 상한).
- 데몬 미기동(연결 거부) 시 timeout 을 기다리지 않고 즉시 비정상 종료하며,
  복사해 붙일 수 있는 해결책(`python -m canctl_core --mock`)을 안내한다.
- 모든 대기 루프는 (원하는 응답 타입 | server `error` | timeout) 중 하나로
  반드시 끝난다. 프로토콜에 상관관계 ID 가 없어 타입 기반으로 매칭한다.
- 출력은 항상 JSON. 성공은 stdout, 오류는 stderr + 비정상 종료코드.
  Windows cp949 콘솔에서도 안전하도록 `ensure_ascii=True`(\\uXXXX 이스케이프)로 쓴다.

종료 코드: 0=성공, 1=서버 error, 3=데몬 연결 불가, 4=응답 timeout, 2=인자 오류.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Any, Callable

import websockets

from . import protocol

DEFAULT_URL = "ws://127.0.0.1:8765"

# 종료 코드(argparse 는 자체적으로 2 를 쓰므로 피한다)
EXIT_OK = 0
EXIT_SERVER_ERROR = 1
EXIT_UNREACHABLE = 3
EXIT_TIMEOUT = 4


class ServerError(Exception):
    """서버가 보낸 error 이벤트(터미널 — 대기 루프를 즉시 끝낸다)."""


class CliError(Exception):
    """CLI 차원의 실패. message 를 JSON 으로 stderr 에 내보내고 code 로 종료한다."""

    def __init__(self, message: str, code: int = EXIT_SERVER_ERROR) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


# --- 인자 파서 헬퍼 -------------------------------------------------------

def auto_int(text: str) -> int:
    """0x.. / 0b.. / 십진수 모두 허용하는 정수 파서(argparse type)."""
    try:
        return int(text, 0)
    except ValueError:
        raise argparse.ArgumentTypeError(f"정수가 아닙니다: {text!r}")


def data_byte(text: str) -> int:
    """0..255 범위의 바이트(16진/십진 허용)."""
    value = auto_int(text)
    if not (0 <= value <= 255):
        raise argparse.ArgumentTypeError(f"data 바이트는 0..255 여야 합니다: {text!r}")
    return value


def parse_signals(pairs: list[str]) -> dict[str, Any]:
    """`name=value` 토큰 목록을 {name: 숫자} dict 로 변환.

    값은 int(0x.. 포함) → float 순으로 시도한다. encode_send 의 signals 인자용.
    """
    out: dict[str, Any] = {}
    for pair in pairs:
        if "=" not in pair:
            raise CliError(f"신호는 name=value 형식이어야 합니다: {pair!r}", code=2)
        name, _, raw = pair.partition("=")
        name = name.strip()
        raw = raw.strip()
        if not name:
            raise CliError(f"신호 이름이 비어있습니다: {pair!r}", code=2)
        try:
            value: Any = int(raw, 0)
        except ValueError:
            try:
                value = float(raw)
            except ValueError:
                raise CliError(f"신호 값이 숫자가 아닙니다: {pair!r}", code=2)
        out[name] = value
    return out


def _frame_command(cmd_type: str, args: argparse.Namespace) -> dict[str, Any]:
    """send / send_periodic 공용 프레임 명령 dict 빌더(테스트 가능한 순수 함수)."""
    return {
        "type": cmd_type,
        "channel": args.channel,
        "can_id": args.can_id,
        "extended": bool(args.ext),
        "rtr": bool(args.rtr),
        "data": list(args.data or []),
    }


# --- 출력 -----------------------------------------------------------------

def emit(obj: Any, pretty: bool = False) -> None:
    """성공 결과를 stdout 에 JSON 으로 출력한다(cp949 안전: ensure_ascii=True)."""
    indent = 2 if pretty else None
    sys.stdout.write(json.dumps(obj, ensure_ascii=True, indent=indent))
    sys.stdout.write("\n")
    sys.stdout.flush()


def emit_error(message: str, code: int) -> None:
    """오류를 stderr 에 JSON 으로 출력한다."""
    sys.stderr.write(json.dumps(
        {"type": "error", "message": message, "exit": code}, ensure_ascii=True))
    sys.stderr.write("\n")
    sys.stderr.flush()


# --- WebSocket 왕복 -------------------------------------------------------

async def _await_message(ws, predicate: Callable[[dict], bool],
                         timeout: float) -> dict:
    """predicate 를 만족하는 첫 메시지를 반환한다.

    - server `error` 이벤트를 받으면 ServerError 로 즉시 중단(터미널).
    - timeout 초과 시 asyncio.TimeoutError.
    그 외(매칭 안 되는 status/rx 등)는 무시하고 계속 읽는다 — 상관관계 ID 가
    없어 브로드캐스트 스트림에서 타입으로 골라내는 구조이기 때문이다.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        msg = json.loads(raw)
        if msg.get("type") == "error":
            raise ServerError(msg.get("message", "알 수 없는 서버 오류"))
        if predicate(msg):
            return msg


async def _collect_rx(ws, *, duration: float, count: int | None,
                      ids: set[int] | None, channel: int | None) -> list[dict]:
    """duration 초 동안(또는 count 개 도달까지) rx 프레임을 모아 반환한다.

    클라이언트 측 필터(ids/channel)는 서버 전역 필터를 건드리지 않는다(부작용 없음).
    server `error` 는 즉시 중단한다. duration 은 항상 하드 상한이라 절대 멈추지 않는다.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + duration
    frames: list[dict] = []
    while True:
        if count is not None and len(frames) >= count:
            break
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        msg = json.loads(raw)
        mtype = msg.get("type")
        if mtype == "error":
            raise ServerError(msg.get("message", "알 수 없는 서버 오류"))
        if mtype != "rx":
            continue
        for fr in msg["frames"]:
            if ids and fr["can_id"] not in ids:
                continue
            if channel is not None and fr["channel"] != channel:
                continue
            frames.append(fr)
            if count is not None and len(frames) >= count:
                break
    return frames


def _first_tx_frame(msg: dict, can_id: int) -> dict | None:
    """rx 배치에서 해당 can_id 의 tx(송신 echo) 프레임을 찾는다."""
    for fr in msg.get("frames", []):
        if fr.get("dir") == "tx" and fr["can_id"] == can_id:
            return fr
    return None


# --- 각 서브커맨드 핸들러(ws, args) -> 결과 dict ---------------------------

async def h_status(ws, args) -> dict:
    # 서버는 WS 연결 직후 status 를 보내준다(별도 명령 불필요).
    return await _await_message(ws, lambda m: m.get("type") == "status", args.timeout)


async def h_devices(ws, args) -> dict:
    await ws.send(json.dumps({"type": "list_devices"}))
    return await _await_message(ws, lambda m: m.get("type") == "devices", args.timeout)


async def h_connect(ws, args) -> dict:
    # 서버는 WS 연결 직후 status 를 한 번 보낸다. 이미 연결된 데몬이라면 그 status 가
    # connected=true 라서, 우리 connect 가 처리되기 전에 매칭돼 '낡은' 상태(예전 bitrate)
    # 를 돌려줄 수 있다(재연결로 bitrate 를 바꾸는 워크플로에서 오답). 먼저 그 연결 직후
    # status 를 비운 뒤 connect 를 보내고, 새로 브로드캐스트되는 status 를 기다린다.
    await _await_message(ws, lambda m: m.get("type") == "status", args.timeout)
    payload = {
        "type": "connect", "device_index": args.device_index,
        "channel": args.channel, "bitrate": args.bitrate,
    }
    # --bitrate1 미지정 시 보내지 않음 → 서버가 bitrate 와 동일하게 처리(하위호환).
    if args.bitrate1 is not None:
        payload["bitrate1"] = args.bitrate1
    await ws.send(json.dumps(payload))
    # 연결 완료 status(connected=true)까지 대기. 실패는 server error 로 중단된다.
    return await _await_message(
        ws, lambda m: m.get("type") == "status" and m.get("connected") is True,
        args.timeout)


async def h_disconnect(ws, args) -> dict:
    await ws.send(json.dumps({"type": "disconnect"}))
    return await _await_message(
        ws, lambda m: m.get("type") == "status" and m.get("connected") is False,
        args.timeout)


async def h_send(ws, args) -> dict:
    await ws.send(json.dumps(_frame_command("send", args)))
    # 서버가 송신 프레임을 tx 로 echo 한다 → 그 프레임으로 큐잉 확인.
    msg = await _await_message(
        ws, lambda m: m.get("type") == "rx"
        and _first_tx_frame(m, args.can_id) is not None, args.timeout)
    return {"ok": True, "frame": _first_tx_frame(msg, args.can_id)}


async def h_send_periodic(ws, args) -> dict:
    cmd = _frame_command("send_periodic", args)
    cmd["period"] = args.period
    if args.count is not None:
        cmd["count"] = args.count
    await ws.send(json.dumps(cmd))
    return await _await_message(
        ws, lambda m: m.get("type") == "periodic_status", args.timeout)


async def h_stop_periodic(ws, args) -> dict:
    cmd: dict[str, Any] = {"type": "stop_periodic"}
    if args.id is not None:
        cmd["id"] = args.id
    await ws.send(json.dumps(cmd))
    return await _await_message(
        ws, lambda m: m.get("type") == "periodic_status", args.timeout)


async def h_filter(ws, args) -> dict:
    cmd: dict[str, Any] = {"type": "set_filter", "ids": list(args.ids or [])}
    if args.mask is not None:
        cmd["mask"] = args.mask
    if args.channel is not None:
        cmd["channel"] = args.channel
    await ws.send(json.dumps(cmd))
    return await _await_message(
        ws, lambda m: m.get("type") == "filter", args.timeout)


async def h_monitor(ws, args) -> dict:
    ids = set(args.ids) if args.ids else None
    frames = await _collect_rx(
        ws, duration=args.duration, count=args.count, ids=ids, channel=args.channel)
    return {"type": "monitor", "count": len(frames), "frames": frames}


async def h_log_start(ws, args) -> dict:
    await ws.send(json.dumps({"type": "start_log", "path": args.path}))
    return await _await_message(
        ws, lambda m: m.get("type") == "log_status" and m.get("logging") is True,
        args.timeout)


async def h_log_stop(ws, args) -> dict:
    await ws.send(json.dumps({"type": "stop_log"}))
    return await _await_message(
        ws, lambda m: m.get("type") == "log_status" and m.get("logging") is False,
        args.timeout)


async def h_replay(ws, args) -> dict:
    await ws.send(json.dumps({"type": "replay", "path": args.path}))
    if args.duration > 0:
        # replay 는 rx 스트림으로 흘러나온다 → duration 동안 모아서 반환.
        frames = await _collect_rx(
            ws, duration=args.duration, count=None, ids=None, channel=None)
        return {"type": "replay", "path": args.path,
                "count": len(frames), "frames": frames}
    # fire-and-forget: 잘못된 경로 등은 짧은 유예 동안 error 로 표면화된다.
    await _grace_error(ws, args.grace)
    return {"ok": True, "replaying": args.path}


async def h_export(ws, args) -> dict:
    await ws.send(json.dumps({
        "type": "export_log", "src": args.src, "dest": args.dest,
        "format": args.format,
    }))
    return await _await_message(
        ws, lambda m: m.get("type") == "export_status", args.timeout)


async def h_dbc_load(ws, args) -> dict:
    await ws.send(json.dumps({"type": "load_dbc", "path": args.path}))
    # load_dbc 는 성공 시 응답이 없다(실패만 error). 유예 동안 error 가 없으면 성공.
    await _grace_error(ws, args.grace)
    return {"ok": True, "loaded": args.path}


async def h_dbc_messages(ws, args) -> dict:
    await ws.send(json.dumps({"type": "list_dbc_messages"}))
    return await _await_message(
        ws, lambda m: m.get("type") == "dbc_messages", args.timeout)


async def h_dbc_send(ws, args) -> dict:
    signals = parse_signals(args.signal or [])
    await ws.send(json.dumps({
        "type": "encode_send", "message": args.message,
        "signals": signals, "channel": args.channel,
    }))
    # encode_send 도 송신 프레임을 tx 로 echo 한다(can_id 는 DBC 가 정하므로 임의 tx 매칭).
    msg = await _await_message(
        ws, lambda m: m.get("type") == "rx"
        and any(f.get("dir") == "tx" for f in m.get("frames", [])), args.timeout)
    tx = next(f for f in msg["frames"] if f.get("dir") == "tx")
    return {"ok": True, "frame": tx}


async def h_raw(ws, args) -> dict:
    """임의 JSON 명령을 보내고 timeout 동안 받은 모든 메시지를 모아 반환(escape hatch)."""
    try:
        cmd = json.loads(args.json)
    except json.JSONDecodeError as exc:
        raise CliError(f"raw 인자 JSON 파싱 실패: {exc}", code=2)
    await ws.send(json.dumps(cmd))
    loop = asyncio.get_running_loop()
    deadline = loop.time() + args.timeout
    messages: list[dict] = []
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        messages.append(json.loads(raw))
    return {"type": "raw_result", "sent": cmd, "messages": messages}


async def _grace_error(ws, grace: float) -> None:
    """grace 초 동안 server error 가 오면 ServerError 로 올린다(없으면 조용히 반환)."""
    if grace <= 0:
        return
    try:
        msg = await asyncio.wait_for(ws.recv(), timeout=grace)
    except asyncio.TimeoutError:
        return
    parsed = json.loads(msg)
    if parsed.get("type") == "error":
        raise ServerError(parsed.get("message", "알 수 없는 서버 오류"))


HANDLERS: dict[str, Callable] = {
    "status": h_status,
    "devices": h_devices,
    "connect": h_connect,
    "disconnect": h_disconnect,
    "send": h_send,
    "send-periodic": h_send_periodic,
    "stop-periodic": h_stop_periodic,
    "filter": h_filter,
    "monitor": h_monitor,
    "log-start": h_log_start,
    "log-stop": h_log_stop,
    "replay": h_replay,
    "export": h_export,
    "dbc-load": h_dbc_load,
    "dbc-messages": h_dbc_messages,
    "dbc-send": h_dbc_send,
    "raw": h_raw,
}


# --- 실행 흐름 ------------------------------------------------------------

async def _run(args: argparse.Namespace) -> dict:
    url = args.url
    try:
        conn = await asyncio.wait_for(
            websockets.connect(url, open_timeout=None), timeout=args.timeout)
    except (OSError, asyncio.TimeoutError, websockets.exceptions.InvalidURI,
            websockets.exceptions.InvalidHandshake) as exc:
        raise CliError(
            f"코어 데몬에 연결할 수 없습니다({url}): {exc}. "
            f"먼저 데몬을 띄우세요 — `python -m canctl_core --mock` "
            f"(실장비는 --mock 없이). 포트가 다르면 --url 로 지정하세요.",
            code=EXIT_UNREACHABLE,
        )
    try:
        handler = HANDLERS[args.command]
        try:
            return await handler(conn, args)
        except ServerError as exc:
            raise CliError(str(exc), code=EXIT_SERVER_ERROR)
        except asyncio.TimeoutError:
            raise CliError(
                f"'{args.command}' 응답 시간 초과({args.timeout}s). 데몬이 살아있는지, "
                f"연결/장치 상태가 명령 전제와 맞는지 확인하세요.",
                code=EXIT_TIMEOUT)
    finally:
        await conn.close()


def _serve(args: argparse.Namespace) -> int:
    """코어 데몬을 포그라운드로 띄운다(`python -m canctl_core` 위임).

    AI/스크립트는 이 명령을 백그라운드로 실행해 데몬을 유지한 뒤 다른 canctl
    서브커맨드로 명령을 보내면 된다.
    """
    from . import __main__ as core_main
    argv: list[str] = []
    if args.mock:
        argv.append("--mock")
    argv += ["--host", args.host, "--port", str(args.port),
             "--log-level", args.log_level]
    core_main.main(argv)
    return EXIT_OK


# --- argparse 구성 --------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    env_url = os.environ.get("CANCTL_URL", DEFAULT_URL)
    parser = argparse.ArgumentParser(
        prog="canctl",
        description="CANalyst-II 제어 코어 CLI (실행 중인 데몬에 WS 로 명령 전송).",
        epilog="데몬 기동: `canctl serve --mock` 또는 `python -m canctl_core --mock`.",
    )
    parser.add_argument("--url", default=env_url,
                        help=f"코어 데몬 WS 주소(기본 {env_url}, 환경변수 CANCTL_URL)")
    parser.add_argument("--timeout", type=float, default=5.0,
                        help="응답 대기 상한(초, 기본 5.0)")
    parser.add_argument("--pretty", action="store_true",
                        help="JSON 출력을 들여쓰기(사람용)")

    sub = parser.add_subparsers(dest="command", required=True, metavar="명령")

    # serve(데몬 기동)
    p = sub.add_parser("serve", help="코어 데몬을 포그라운드로 띄운다")
    p.add_argument("--mock", action="store_true", help="mock 백엔드(장비 불필요)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--log-level", default="INFO")

    # 상태/장치
    sub.add_parser("status", help="현재 연결 상태 조회")
    sub.add_parser("devices", help="연결 가능한 장치 목록")

    p = sub.add_parser("connect",
                       help="장치 연결(채널0·채널1 비트레이트를 따로 지정 가능)")
    p.add_argument("device_index", type=int, help="장치 인덱스(devices 의 index)")
    p.add_argument("--channel", type=int, default=0,
                   help="프로토콜 호환용(채널 선택엔 미사용)")
    p.add_argument("--bitrate", type=int, default=500000,
                   help="채널0 비트레이트(기본 500000)")
    p.add_argument("--bitrate1", type=int, default=None,
                   help="채널1 비트레이트(생략 시 --bitrate 와 동일)")

    sub.add_parser("disconnect", help="장치 연결 해제")

    # 송신
    p = sub.add_parser("send", help="CAN 프레임 1회 송신")
    _add_frame_args(p)

    p = sub.add_parser("send-periodic", help="주기 송신 시작")
    _add_frame_args(p)
    p.add_argument("--period", type=float, required=True, help="송신 주기(초, 0 초과)")
    p.add_argument("--count", type=int, default=None, help="송신 횟수(생략 시 무한)")

    p = sub.add_parser("stop-periodic", help="주기 송신 중지")
    p.add_argument("id", type=int, nargs="?", default=None,
                   help="중지할 태스크 id(생략 시 전체 중지)")

    # 수신 필터/모니터
    p = sub.add_parser("filter", help="서버 전역 수신 필터 설정(전체 교체)")
    p.add_argument("--ids", type=auto_int, nargs="*", default=[],
                   help="통과시킬 CAN ID 목록(빈 목록=전체 통과)")
    p.add_argument("--mask", type=auto_int, default=None,
                   help="ID 마스크(생략 시 정확 일치)")
    p.add_argument("--channel", type=int, default=None,
                   help="채널 한정(생략 시 전체)")

    p = sub.add_parser("monitor", help="수신 프레임을 유한 시간 동안 수집(클라 측 필터)")
    p.add_argument("--duration", type=float, default=5.0,
                   help="수집 시간 상한(초, 기본 5.0)")
    p.add_argument("--count", type=int, default=None,
                   help="이 개수에 도달하면 조기 종료")
    p.add_argument("--ids", type=auto_int, nargs="*", default=[],
                   help="이 CAN ID 만 수집(클라이언트 측 필터, 서버 상태 불변)")
    p.add_argument("--channel", type=int, default=None, help="이 채널만 수집")

    # 로깅/재생/내보내기
    p = sub.add_parser("log-start", help="수신 프레임 JSONL 로깅 시작")
    p.add_argument("path", help="로그 파일 경로")
    sub.add_parser("log-stop", help="로깅 종료")

    p = sub.add_parser("replay", help="기록 파일을 rx 스트림으로 재생")
    p.add_argument("path", help="재생할 파일(.jsonl/.asc/.blf/.trc/.mf4)")
    p.add_argument("--duration", type=float, default=0.0,
                   help=">0 이면 그 시간 동안 재생 프레임을 수집해 반환")
    p.add_argument("--grace", type=float, default=0.5,
                   help="fire-and-forget 시 error 확인 유예(초)")

    p = sub.add_parser("export", help="JSONL 로그를 표준 포맷으로 내보내기")
    p.add_argument("src", help="원본 JSONL 경로")
    p.add_argument("dest", help="출력 경로")
    p.add_argument("--format", required=True, choices=sorted(protocol.EXPORT_FORMATS),
                   help="출력 포맷")

    # DBC
    p = sub.add_parser("dbc-load", help="DBC 파일 로드(rx 에 신호 디코딩 부착)")
    p.add_argument("path", help="DBC 파일 경로")
    p.add_argument("--grace", type=float, default=1.0, help="error 확인 유예(초)")

    sub.add_parser("dbc-messages", help="로드된 DBC 의 메시지·신호 목록")

    p = sub.add_parser("dbc-send", help="DBC 신호값을 인코딩해 송신")
    p.add_argument("message", help="DBC 메시지 이름")
    p.add_argument("--signal", action="append", default=[], metavar="이름=값",
                   help="신호 값(여러 번 지정 가능)")
    p.add_argument("--channel", type=int, default=0, help="송신 채널(기본 0)")

    # escape hatch
    p = sub.add_parser("raw", help="임의 JSON 명령을 보내고 받은 메시지를 모두 출력")
    p.add_argument("json", help='보낼 명령 JSON(예: \'{"type":"list_devices"}\')')

    return parser


def _add_frame_args(p: argparse.ArgumentParser) -> None:
    """send / send-periodic 공용 프레임 인자."""
    p.add_argument("can_id", type=auto_int, help="CAN ID(0x123 또는 십진수)")
    p.add_argument("--data", type=data_byte, nargs="*", default=[],
                   help="데이터 바이트 0..8개(예: --data 0x01 0x02 10)")
    p.add_argument("--channel", type=int, default=0, help="송신 채널(기본 0)")
    p.add_argument("--ext", action="store_true", help="확장 ID(29비트)")
    p.add_argument("--rtr", action="store_true", help="RTR 프레임")


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "serve":
        sys.exit(_serve(args))

    try:
        result = asyncio.run(_run(args))
    except CliError as exc:
        emit_error(exc.message, exc.code)
        sys.exit(exc.code)
    except KeyboardInterrupt:
        sys.exit(130)
    emit(result, args.pretty)
    sys.exit(EXIT_OK)


if __name__ == "__main__":
    main()
