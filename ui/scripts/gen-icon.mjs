// CAN 테마 앱 아이콘 생성 스크립트
//
// 순수 JS(pngjs)만 사용해 512x512 RGBA PNG를 ui/build/icon.png 로 출력한다.
// native(sharp/canvas) 의존성 없이 픽셀 버퍼에 직접 그려 빌드 환경 제약을 피한다.
// 실행: ui/ 디렉토리에서 `node scripts/gen-icon.mjs`
//
// 디자인: 테크 블루→틸 대각 그라데이션 배경(둥근 모서리) 위에
//   CAN 버스 차동쌍(CAN_H/CAN_L)을 상징하는 굵은 수평선 2개를 얹는다.
//   작은 크기에서도 식별되도록 모티프를 단순하게 유지한다.

import { mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// pngjs 는 CommonJS 모듈이라 .mjs 에서는 default 임포트 후 구조분해로 가져온다.
import pkg from 'pngjs'
const { PNG } = pkg

// .mjs 에는 __dirname 이 없으므로 import.meta.url 로 스크립트 위치를 구한다.
const scriptDir = dirname(fileURLToPath(import.meta.url))
const buildDir = join(scriptDir, '..', 'build')
const outPath = join(buildDir, 'icon.png')

const SIZE = 512
const png = new PNG({ width: SIZE, height: SIZE })

// 색상 팔레트(테크 블루 ~ 틸)
const TOP = { r: 0x10, g: 0x3a, b: 0x66 } // 진한 블루(좌상단)
const BOTTOM = { r: 0x14, g: 0x9c, b: 0x9c } // 틸(우하단)
const CAN_H = { r: 0x6f, g: 0xe6, b: 0xff } // 밝은 시안(상단 신호선)
const CAN_L = { r: 0xff, g: 0xd1, b: 0x66 } // 황색(하단 신호선)
const DOT = { r: 0xff, g: 0xff, b: 0xff } // 데이터 비트 점

// 둥근 모서리 반경, 모서리 바깥은 투명 처리해 아이콘 느낌을 준다.
const RADIUS = 96

// 한 픽셀에 RGBA 를 기록한다. 알파 미지정 시 불투명(255).
function setPixel(x, y, c, a = 255) {
  const idx = (SIZE * y + x) << 2
  png.data[idx] = c.r
  png.data[idx + 1] = c.g
  png.data[idx + 2] = c.b
  png.data[idx + 3] = a
}

// 둥근 사각형 내부 여부(모서리만 원호로 깎는다).
function isInsideRounded(x, y) {
  const r = RADIUS
  // 각 모서리 중심으로부터 거리 검사
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r
  if (x >= SIZE - r && y < r) return (x - (SIZE - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
  if (x < r && y >= SIZE - r) return (x - r) ** 2 + (y - (SIZE - 1 - r)) ** 2 <= r * r
  if (x >= SIZE - r && y >= SIZE - r)
    return (x - (SIZE - 1 - r)) ** 2 + (y - (SIZE - 1 - r)) ** 2 <= r * r
  return true
}

// 두 색을 t(0~1) 비율로 선형 보간.
function lerp(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  }
}

// 신호선(굵은 수평 막대)을 그린다. 데이터 비트를 흉내 낸 점선 단절을 포함.
function drawSignalLine(centerY, thickness, color) {
  const half = thickness >> 1
  const left = 80
  const right = SIZE - 80
  for (let y = centerY - half; y <= centerY + half; y++) {
    if (y < 0 || y >= SIZE) continue
    for (let x = left; x <= right; x++) {
      // 일정 간격마다 비트 갭을 만들어 디지털 신호 느낌을 준다.
      const inGap = Math.floor((x - left) / 38) % 4 === 3
      if (inGap) continue
      if (!isInsideRounded(x, y)) continue
      setPixel(x, y, color)
    }
  }
}

// 신호선 끝의 노드(데이터 비트)를 강조하는 작은 점.
function drawDot(cx, cy, radius, color) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue
      if (!isInsideRounded(x, y)) continue
      setPixel(x, y, color)
    }
  }
}

// 1) 대각 그라데이션 배경(둥근 모서리 바깥은 투명).
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!isInsideRounded(x, y)) {
      setPixel(x, y, TOP, 0) // 투명
      continue
    }
    const t = (x + y) / (2 * (SIZE - 1)) // 좌상→우하 대각 비율
    setPixel(x, y, lerp(TOP, BOTTOM, t))
  }
}

// 2) CAN 차동쌍 신호선 2개(상: CAN_H, 하: CAN_L).
drawSignalLine(212, 34, CAN_H)
drawSignalLine(300, 34, CAN_L)

// 3) 신호선 양끝 노드 점으로 버스 종단을 표현.
drawDot(80, 212, 26, DOT)
drawDot(SIZE - 80, 212, 26, DOT)
drawDot(80, 300, 26, DOT)
drawDot(SIZE - 80, 300, 26, DOT)

// build/ 디렉토리를 보장하고, 동기 인코딩으로 완전한 파일을 쓴다.
// (스트림 pipe 후 즉시 statSync 하면 미완성 파일 크기를 읽을 수 있어 동기 방식 사용.)
mkdirSync(buildDir, { recursive: true })
writeFileSync(outPath, PNG.sync.write(png))

// 생성 결과 로그(>=512 확인용).
const bytes = PNG.sync.write(png).length
console.log(`아이콘 생성 완료: ${outPath}`)
console.log(`크기: ${SIZE}x${SIZE}, 파일 바이트: ${bytes}`)
