// CAN 프레임 배열을 CSV 문자열로 변환하고 브라우저 다운로드를 트리거하는 유틸.
// 렌더러는 fs 에 접근할 수 없으므로 Blob + 숨김 <a download> 클릭 방식으로 내보낸다.

// CSV 컬럼 순서(헤더와 동일)
const CSV_HEADER = ['timestamp', 'dir', 'channel', 'can_id', 'extended', 'rtr', 'dlc', 'data']

// can_id 를 0x 접두 16진수로(확장 프레임은 8자리, 표준은 3자리 패딩)
function fmtId(id, extended) {
  return '0x' + id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0')
}

// data 바이트 배열을 공백 구분 16진수 문자열로("AB CD ..."). 콤마를 쓰면 CSV 열이 깨진다.
function fmtData(data) {
  if (!data || data.length === 0) return ''
  return data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

// 한 셀 값을 CSV 안전하게 인용한다. 콤마·따옴표·개행이 있으면 따옴표로 감싸고
// 내부 따옴표는 두 개로 이스케이프한다(RFC 4180).
function csvCell(value) {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * 프레임 배열을 CSV 문자열로 변환한다(헤더 1줄 + 프레임당 1줄).
 * dir 미지정 프레임은 수신으로 보고 'rx' 로 표기한다.
 * @param {Array} frames RxMonitor 가 받는 프레임 형식
 * @returns {string} CSV 본문(줄바꿈 \n)
 */
export function framesToCsv(frames) {
  const lines = [CSV_HEADER.join(',')]
  for (const f of frames) {
    const dir = f.dir === 'tx' ? 'tx' : 'rx'
    const row = [
      // 시간값은 ms(소수점 3자리)까지만 — epoch 부동소수의 잔여 자리수를 잘라 화면 표시와 맞춘다.
      Number(f.ts).toFixed(3),
      dir,
      f.channel,
      fmtId(f.can_id, f.extended),
      f.extended ? 'true' : 'false',
      f.rtr ? 'true' : 'false',
      f.dlc,
      fmtData(f.data)
    ]
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\n')
}

/**
 * CSV 문자열을 파일로 다운로드시킨다(Blob + 숨김 <a download> 클릭).
 * jsdom 에는 URL.createObjectURL 이 없으므로 이 함수는 테스트 대상에서 제외한다.
 * @param {string} csv CSV 본문
 * @param {string} filename 기본 파일명
 */
export function downloadCsv(csv, filename = 'can-frames.csv') {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 'prefix-YYYYMMDD-HHMMSS.ext' 형식의 타임스탬프 파일명을 만든다.
// 모니터 CSV 즉석 내보내기·로그 파일·로그 내보내기가 공유한다(이름-날짜-시간 규칙 통일).
export function makeTimestampedName(prefix, ext, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${prefix}-${y}${mo}${d}-${h}${mi}${s}.${ext}`
}

// 모니터 CSV 즉석 내보내기 파일명(can-frames-YYYYMMDD-HHMMSS.csv). 기존 호출 보존.
export function csvFilename(date = new Date()) {
  return makeTimestampedName('can-frames', 'csv', date)
}
