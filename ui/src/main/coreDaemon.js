import net from 'net'

/**
 * 로컬 포트에 이미 코어 데몬(또는 다른 리스너)이 떠 있는지 TCP 접속으로 확인한다.
 *
 * 앱·플러그인·수동 실행이 모두 같은 포트(8765)의 단일 데몬을 공유하는 구조라,
 * 앱이 사이드카를 새로 띄우기 전에 "이미 누가 데몬을 띄웠는지"를 이걸로 판단한다.
 * 접속 성공 = 무언가 듣고 있음(true). 거부/타임아웃 = 없음(false).
 * 주의: 이건 **liveness(누가 듣나)** 확인이지 프로토콜 확인이 아니다 — 8765 를 코어가
 * 아닌 다른 프로세스가 점유해도 true 가 된다(앱 전용 포트라 실무상 거의 없음).
 *
 * @param {number} port 확인할 포트
 * @param {{host?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<boolean>}
 */
export function probeDaemon(port, { host = '127.0.0.1', timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (alive) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(alive)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}
