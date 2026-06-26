import { describe, it, expect } from 'vitest'
import { makeTimestampedName, csvFilename } from './csvExport'

// 파일명 자동 생성 규칙(이름-날짜-시간) 테스트. 날짜를 인자로 고정해 결정적으로 검증한다.
// (downloadCsv 는 jsdom 에 URL.createObjectURL 이 없어 호출하지 않는다 — 여기선 순수 함수만.)
describe('makeTimestampedName', () => {
  // new Date(2026, 5, 26, 9, 5, 3) = 2026-06-26 09:05:03 (월은 0-base)
  const d = new Date(2026, 5, 26, 9, 5, 3)

  it('prefix-YYYYMMDD-HHMMSS.ext 형식으로 0 패딩해 만든다', () => {
    expect(makeTimestampedName('canctl-log', 'jsonl', d)).toBe('canctl-log-20260626-090503.jsonl')
    expect(makeTimestampedName('canctl-export', 'blf', d)).toBe('canctl-export-20260626-090503.blf')
  })

  it('csvFilename 은 can-frames prefix 의 csv 로 위 헬퍼를 재사용한다', () => {
    expect(csvFilename(d)).toBe('can-frames-20260626-090503.csv')
  })
})
