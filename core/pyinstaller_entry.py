"""PyInstaller 엔트리포인트.

PyInstaller 는 `python -m` 모듈 실행을 지원하지 않으므로, 패키징된 단일
실행파일이 코어를 기동할 수 있도록 패키지의 main() 을 호출하는 스크립트를 둔다.
"""
from canctl_core.__main__ import main

if __name__ == "__main__":
    main()
