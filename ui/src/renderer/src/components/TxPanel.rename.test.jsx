import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import TxPanel from './TxPanel'

// 프리셋 이름 인라인 편집(rename) 테스트.
// name 은 프리셋의 식별자(key)이므로 커밋 시 빈 이름·중복 이름을 막아야 한다.

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

describe('프리셋 이름 변경(인라인 편집)', () => {
  it('이름 변경 버튼 → input 으로 바뀌고 Enter 로 새 이름이 커밋된다(값은 보존)', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '엔진', '111')
    await user.click(screen.getByRole('button', { name: '이름 변경' }))

    const input = screen.getByLabelText('엔진 이름 변경')
    await user.clear(input)
    await user.type(input, '엔진RPM{Enter}')

    expect(screen.getByText('엔진RPM')).toBeInTheDocument()
    expect(screen.queryByText('엔진')).not.toBeInTheDocument()
    // canId 등 값은 그대로 유지된다(이름만 바뀜)
    expect(screen.getByText('엔진RPM').getAttribute('title')).toContain('111')
  })

  it('Esc 를 누르면 편집이 취소되고 원래 이름이 유지된다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '원래이름', '111')
    await user.click(screen.getByRole('button', { name: '이름 변경' }))

    const input = screen.getByLabelText('원래이름 이름 변경')
    await user.clear(input)
    await user.type(input, '바뀐이름{Escape}')

    expect(screen.getByText('원래이름')).toBeInTheDocument()
    expect(screen.queryByText('바뀐이름')).not.toBeInTheDocument()
  })

  it('빈 이름으로 커밋하면 오류를 표시하고 편집을 유지한다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '엔진', '111')
    await user.click(screen.getByRole('button', { name: '이름 변경' }))

    const input = screen.getByLabelText('엔진 이름 변경')
    await user.clear(input)
    await user.type(input, '{Enter}')

    expect(screen.getByText('프리셋 이름을 입력하세요')).toBeInTheDocument()
    // 편집 input 이 닫히지 않고 유지된다
    expect(screen.getByLabelText('엔진 이름 변경')).toBeInTheDocument()
  })

  it('다른 프리셋과 같은 이름으로 커밋하면 거부하고 오류를 표시한다(병합하지 않음)', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, 'A', '111')
    await saveNew(user, 'B', '222')

    // B 행의 이름 변경 → 기존 이름 'A' 로 커밋 시도
    const rowB = screen.getByText('B').closest('li')
    await user.click(within(rowB).getByRole('button', { name: '이름 변경' }))

    const input = screen.getByLabelText('B 이름 변경')
    await user.clear(input)
    await user.type(input, 'A{Enter}')

    expect(screen.getByText(/이미 있습니다/)).toBeInTheDocument()
    // A 는 여전히 하나, B 의 편집 input 도 유지(두 프리셋이 합쳐지지 않음)
    expect(screen.getAllByText('A')).toHaveLength(1)
    expect(screen.getByLabelText('B 이름 변경')).toBeInTheDocument()
  })
})
