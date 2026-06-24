"""pytest 공용 설정.

`core/` 를 sys.path 에 추가해, 패키지(canctl_core) 밖 최상위 스크립트인
`pyinstaller_entry.py` 를 테스트에서 import 할 수 있게 한다. `python -m pytest` 는 cwd 를
sys.path 에 넣어줘 우연히 동작하지만, CI 의 `pytest -q` 는 그렇지 않으므로 여기서 명시한다.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
