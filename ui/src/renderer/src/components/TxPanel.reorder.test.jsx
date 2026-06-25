import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TxPanel from './TxPanel'

// 프리셋 드래그 재정렬 + "채널은 프리셋 비종속(현재 송신 채널 사용)" 동작 테스트.
// 기존 TxPanel.test.jsx(기본 송신/주기/프리셋 저장·로드)와 별개로 추가 기능만 검증한다.

// ID 입력을 주어진 값으로 바꾼다.
async function setId(user, id) {
  const idInput = screen.getByLabelText('ID(hex)')
  await user.clear(idInput)
  await user.type(idInput, id)
}

// 고유 이름 프리셋 1개를 저장한다(같은 이름이 없을 때만 — 확인 단계 없이 즉시 저장).
async function saveNew(user, name, id) {
  await setId(user, id)
  await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), name)
  await user.click(screen.getByText('프리셋 저장'))
}

// 현재 화면의 프리셋 이름들을 표시 순서대로 모은다.
function presetNames() {
  return Array.from(document.querySelectorAll('.tx-preset-name')).map((n) => n.textContent)
}

// 채널 select 는 <label>송신 채널(CH)<select> 래핑이라 옵션 텍스트가 라벨에 섞이므로
// 정확 문자열 대신 부분 일치(정규식)로 찾는다.
function channelSelect() {
  return screen.getByLabelText(/송신 채널/)
}

describe('프리셋 드래그 재정렬', () => {
  it('핸들을 드래그해 다른 행에 드롭하면 순서가 바뀐다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, 'A', '111')
    await saveNew(user, 'B', '222')
    await saveNew(user, 'C', '333')
    expect(presetNames()).toEqual(['A', 'B', 'C'])

    // C(인덱스 2)를 끌어 A(인덱스 0)에 드롭 → C, A, B
    const handles = document.querySelectorAll('.tx-preset-drag')
    const rows = document.querySelectorAll('.tx-preset')
    fireEvent.dragStart(handles[2])
    fireEvent.dragOver(rows[0])
    fireEvent.drop(rows[0])

    expect(presetNames()).toEqual(['C', 'A', 'B'])
  })

  it('같은 자리에 드롭하면 순서가 그대로다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, 'A', '111')
    await saveNew(user, 'B', '222')

    const handles = document.querySelectorAll('.tx-preset-drag')
    const rows = document.querySelectorAll('.tx-preset')
    fireEvent.dragStart(handles[0])
    fireEvent.dragOver(rows[0])
    fireEvent.drop(rows[0])

    expect(presetNames()).toEqual(['A', 'B'])
  })
})

describe('프리셋은 채널 비종속(현재 송신 채널 사용)', () => {
  it('재전송은 프리셋이 아니라 현재 송신 채널로 보낸다', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={onSend} />)

    // 채널 0(기본)에서 프리셋 저장(ID 7DF)
    await saveNew(user, 'P', '7DF')
    // 현재 송신 채널을 1로 변경
    await user.selectOptions(channelSelect(), '1')

    await user.click(screen.getByRole('button', { name: '재전송' }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ can_id: 0x7df, channel: 1 })
    )
  })

  it('프리셋 로드는 현재 송신 채널을 바꾸지 않는다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, 'P', '7DF')
    await user.selectOptions(channelSelect(), '1')
    await user.click(screen.getByRole('button', { name: '로드' }))

    expect(channelSelect()).toHaveValue('1')
  })

  it('저장 시 채널을 프리셋에 포함하지 않는다(localStorage 검사)', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await user.selectOptions(channelSelect(), '1')
    await saveNew(user, 'P', '7DF')

    const stored = JSON.parse(localStorage.getItem('canctl.tx.presets'))
    expect(stored).toHaveLength(1)
    expect(stored[0]).not.toHaveProperty('channel')
    expect(stored[0].canId).toBe('7DF')
  })

  it('과거(channel 포함) 프리셋은 로드 시 정규화로 channel 이 제거된다', async () => {
    localStorage.setItem(
      'canctl.tx.presets',
      JSON.stringify([
        { name: 'old', canId: '7DF', channel: 1, extended: false, rtr: false, dataStr: 'AA' }
      ])
    )
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    // 초기 정규화 useEffect 가 channel 키를 제거해 다시 저장한다.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('canctl.tx.presets'))
      expect(stored[0]).not.toHaveProperty('channel')
    })
    expect(screen.getByText('old')).toBeInTheDocument()
  })
})
