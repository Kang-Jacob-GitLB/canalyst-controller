import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { usePersistentState } from './usePersistentState'

describe('usePersistentState', () => {
  beforeEach(() => localStorage.clear())

  it('localStorage 가 비면 기본값을 쓴다', () => {
    const { result } = renderHook(() => usePersistentState('k1', 'def'))
    expect(result.current[0]).toBe('def')
  })

  it('값을 변경하면 localStorage 에 저장된다', () => {
    const { result } = renderHook(() => usePersistentState('k2', 'a'))
    act(() => result.current[1]('b'))
    expect(result.current[0]).toBe('b')
    expect(JSON.parse(localStorage.getItem('k2'))).toBe('b')
  })

  it('저장된 값이 있으면 그 값으로 복원한다(재마운트 모방)', () => {
    localStorage.setItem('k3', JSON.stringify(42))
    const { result } = renderHook(() => usePersistentState('k3', 0))
    expect(result.current[0]).toBe(42)
  })

  it('깨진 JSON 이 저장돼 있으면 기본값으로 폴백한다', () => {
    localStorage.setItem('k4', '{not json')
    const { result } = renderHook(() => usePersistentState('k4', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })
})
