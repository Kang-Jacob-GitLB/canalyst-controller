import { useEffect, useState } from 'react'

/**
 * localStorage 에 값을 보존하는 useState.
 * 앱을 종료했다가 다시 켜도 마지막 값이 유지된다.
 *
 * @param {string} key   localStorage 키(네임스페이스 권장: "canctl.tx.canId")
 * @param {*} defaultValue 저장된 값이 없을 때 쓸 기본값
 */
export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 저장 실패(쿼터 초과 등)는 무시 — 영속화는 부가 기능
    }
  }, [key, value])

  return [value, setValue]
}
