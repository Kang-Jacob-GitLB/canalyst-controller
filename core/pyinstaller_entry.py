"""PyInstaller 엔트리포인트.

PyInstaller 는 `python -m` 모듈 실행을 지원하지 않으므로, 패키징된 단일
실행파일(`canalyst-core`)이 코어를 기동할 수 있도록 패키지의 멀티콜
디스패처를 호출하는 스크립트를 둔다.

실제 분기(서버 / cli / mcp)는 `canctl_core.multicall.main` 이 담당한다 — 동결
바이너리와 pip 콘솔 스크립트(`canalyst-core`)가 같은 코드를 공유한다.
"""
from canctl_core.multicall import main

if __name__ == "__main__":
    main()
