"""실장비 스모크 테스트: CANalyst-II 장치 open + 프레임 read 확인.

UI 단계를 짓기 전에, 리버스 엔지니어링 드라이버가 *이 장비*를 실제로 읽는지 먼저 검증한다.

사용법 (실장비 USB 연결 후, Windows 는 Zadig 로 WinUSB 드라이버 설정 필요):
    core/.venv/Scripts/python scripts/smoke_device.py --channel 0 --bitrate 500000
"""
import argparse
import sys
import time
from pathlib import Path

# core 패키지를 import 경로에 추가(editable 설치가 없어도 동작하도록)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))

from canctl_core.canalystii_backend import CanalystIIBackend  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="CANalyst-II 실장비 스모크 테스트")
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--channel", type=int, default=0)
    parser.add_argument("--bitrate", type=int, default=500000)
    parser.add_argument("--seconds", type=float, default=3.0)
    args = parser.parse_args()

    backend = CanalystIIBackend()
    print("devices:", backend.list_devices())
    print(f"connecting device={args.device} channel={args.channel} "
          f"bitrate={args.bitrate} ...")
    backend.connect(args.device, args.channel, args.bitrate)
    print("connected. reading frames...")

    total = 0
    end = time.time() + args.seconds
    try:
        while time.time() < end:
            for frame in backend.poll():
                total += 1
                if total <= 20:
                    print(f"  id=0x{frame.can_id:X} ext={frame.extended} "
                          f"dlc={frame.dlc} data={frame.data}")
            time.sleep(0.05)
    finally:
        backend.disconnect()

    print(f"TOTAL_FRAMES={total}")
    if total == 0:
        print("경고: 프레임 0개 — 버스 트래픽이 없거나 비트레이트 불일치일 수 있습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
