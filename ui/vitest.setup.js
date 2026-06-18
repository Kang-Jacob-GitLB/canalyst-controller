import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// 영속화(localStorage)가 테스트 간에 새지 않도록 매 테스트 후 초기화
afterEach(() => {
  localStorage.clear()
})
