import { describe, it, expect } from 'vitest'
import { framesToCsv, csvFilename } from './csvExport'

const frame = (over = {}) => ({
  _seq: 1,
  ts: 1.234,
  channel: 0,
  can_id: 0x100,
  extended: false,
  rtr: false,
  dlc: 2,
  data: [0xab, 0xcd],
  ...over
})

describe('framesToCsv', () => {
  it('빈 배열이면 헤더 줄만 반환한다', () => {
    const csv = framesToCsv([])
    expect(csv).toBe('timestamp,dir,channel,can_id,extended,rtr,dlc,data')
  })

  it('표준 프레임을 컬럼 순서대로 직렬화한다', () => {
    const csv = framesToCsv([frame()])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('timestamp,dir,channel,can_id,extended,rtr,dlc,data')
    // ts=1.234, dir=rx(기본), channel=0, id=0x100, ext=false, rtr=false, dlc=2, data="AB CD"
    expect(lines[1]).toBe('1.234,rx,0,0x100,false,false,2,AB CD')
  })

  it('data 바이트는 공백 구분 대문자 16진수로(콤마로 열을 깨지 않는다)', () => {
    const csv = framesToCsv([frame({ data: [0x00, 0x0f, 0xff] })])
    const cols = csv.split('\n')[1].split(',')
    // 컬럼이 정확히 8개여야 한다(data 안에 콤마가 없어야 함)
    expect(cols).toHaveLength(8)
    expect(cols[7]).toBe('00 0F FF')
  })

  it('빈 data 는 빈 셀로 표기한다', () => {
    const csv = framesToCsv([frame({ data: [], dlc: 0 })])
    const cols = csv.split('\n')[1].split(',')
    expect(cols).toHaveLength(8)
    expect(cols[7]).toBe('')
  })

  it('확장 프레임 ID 는 8자리, RTR/extended 플래그를 반영한다', () => {
    const csv = framesToCsv([
      frame({ can_id: 0x18ff50e5, extended: true, rtr: true })
    ])
    const cols = csv.split('\n')[1].split(',')
    expect(cols[3]).toBe('0x18FF50E5')
    expect(cols[4]).toBe('true') // extended
    expect(cols[5]).toBe('true') // rtr
  })

  it('dir 미지정 프레임은 rx, dir==="tx" 는 tx 로 표기한다', () => {
    const csv = framesToCsv([frame(), frame({ dir: 'tx' })])
    const lines = csv.split('\n')
    expect(lines[1].split(',')[1]).toBe('rx')
    expect(lines[2].split(',')[1]).toBe('tx')
  })

  it('여러 프레임을 헤더 + N줄로 직렬화한다', () => {
    const csv = framesToCsv([frame({ can_id: 0x111 }), frame({ can_id: 0x222 }), frame({ can_id: 0x333 })])
    expect(csv.split('\n')).toHaveLength(4) // 헤더 + 3줄
  })
})

describe('csvFilename', () => {
  it('can-frames-YYYYMMDD-HHMMSS.csv 형식을 만든다', () => {
    // 2026-06-19 14:05:09 (월은 0-based 이므로 5)
    const d = new Date(2026, 5, 19, 14, 5, 9)
    expect(csvFilename(d)).toBe('can-frames-20260619-140509.csv')
  })
})
