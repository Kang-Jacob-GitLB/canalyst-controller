// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import net from 'net'
import { probeDaemon } from './coreDaemon'

let server = null

afterEach(() => {
  if (server) {
    server.close()
    server = null
  }
})

function listen() {
  return new Promise((resolve) => {
    server = net.createServer()
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

describe('probeDaemon', () => {
  it('리스너가 있으면 true', async () => {
    const port = await listen()
    expect(await probeDaemon(port)).toBe(true)
  })

  it('아무도 없으면 false', async () => {
    // 잠깐 열었다 닫아 거의 확실히 비어있는 포트를 얻는다
    const port = await listen()
    await new Promise((r) => server.close(r))
    server = null
    expect(await probeDaemon(port, { timeoutMs: 300 })).toBe(false)
  })
})
