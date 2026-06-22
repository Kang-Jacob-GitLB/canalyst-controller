import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// 영속화(localStorage)가 테스트 간에 새지 않도록 매 테스트 후 초기화.
// main 프로세스 테스트는 node 환경이라 localStorage 가 없으므로 가드한다.
afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
