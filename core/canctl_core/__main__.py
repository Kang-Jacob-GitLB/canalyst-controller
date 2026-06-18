"""코어 진입점: python -m canctl_core [--mock] [--host 127.0.0.1] [--port 8765]"""
from __future__ import annotations

import argparse
import asyncio
import logging

from .backend import CanBackend
from .server import CanServer


def build_backend(use_mock: bool) -> CanBackend:
    if use_mock:
        from .mock_backend import MockBackend
        return MockBackend()
    try:
        from .canalystii_backend import CanalystIIBackend
    except ImportError as exc:
        raise SystemExit(
            "실장비 백엔드(canalystii)를 불러올 수 없습니다. "
            "의존성 설치(pip install -e .) 후 사용하거나, 지금은 --mock 으로 실행하세요. "
            f"(원인: {exc})"
        )
    return CanalystIIBackend()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="canctl_core",
        description="CANalyst-II 제어 코어 (로컬 WebSocket 서버)",
    )
    parser.add_argument("--mock", action="store_true",
                        help="가짜 CAN 트래픽을 내는 mock 백엔드 사용(장비 불필요)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    backend = build_backend(args.mock)
    server = CanServer(backend, host=args.host, port=args.port)
    try:
        asyncio.run(server.run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
