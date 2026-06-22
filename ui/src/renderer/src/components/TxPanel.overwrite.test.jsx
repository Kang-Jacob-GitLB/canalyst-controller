import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import TxPanel from './TxPanel'

// 프리셋 덮어쓰기 기능 테스트:
//  1) 저장 시 같은 이름 덮어쓰기 확인(확인/취소)
//  2) 목록의 프리셋별 "덮어쓰기" 버튼(현재 폼 값으로 갱신, 위치 유지)
//  3) 가져오기 "전체 덮어쓰기" 모드(확인/취소, 빈 목록은 즉시 교체)

// 폼 ID 입력을 주어진 값으로 바꾼다.
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

// 프리셋 배열을 JSON 파일로 가져오기 트리거(FileReader 비동기).
function importFile(presetsArr) {
  const file = new File([JSON.stringify(presetsArr)], 'presets.json', {
    type: 'application/json'
  })
  const input = document.querySelector('input[type=file]')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('프리셋 저장 시 같은 이름 덮어쓰기 확인', () => {
  it('새 이름은 확인 없이 즉시 저장된다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '신규', '7DF')

    expect(screen.getByText('신규')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('같은 이름 저장 시 확인 배너를 띄우고, 확인 누르면 1개만 교체한다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '공통', '7DF')
    expect(screen.getByText('공통').getAttribute('title')).toContain('7DF')

    // 같은 이름 "공통"을 다른 ID(555)로 다시 저장 → 확인 배너 등장(아직 교체 안 됨)
    await setId(user, '555')
    await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '공통')
    await user.click(screen.getByText('프리셋 저장'))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent("'공통'")
    expect(screen.getByText('공통').getAttribute('title')).toContain('7DF') // 아직 유지

    // 확인 → 555 로 교체, 중복 추가 아님
    await user.click(within(dialog).getByText('확인'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getAllByText('공통')).toHaveLength(1)
    expect(screen.getByText('공통').getAttribute('title')).toContain('555')
  })

  it('같은 이름 저장 시 취소를 누르면 변화가 없다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '공통', '7DF')

    await setId(user, '555')
    await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), '공통')
    await user.click(screen.getByText('프리셋 저장'))

    await user.click(within(screen.getByRole('alertdialog')).getByText('취소'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getAllByText('공통')).toHaveLength(1)
    expect(screen.getByText('공통').getAttribute('title')).toContain('7DF') // 원래 값 유지
  })
})

describe('프리셋별 덮어쓰기 버튼(현재 폼 값으로 갱신)', () => {
  it('확인하면 해당 프리셋만 현재 폼 값으로 갱신되고 위치가 유지된다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    // A(111), B(222) 순서로 저장
    await saveNew(user, 'A', '111')
    await saveNew(user, 'B', '222')

    // 폼을 999 로 바꾸고 A 행의 "덮어쓰기" → 확인
    await setId(user, '999')
    const rowA = screen.getByText('A').closest('li')
    await user.click(within(rowA).getByText('덮어쓰기'))
    await user.click(within(screen.getByRole('alertdialog')).getByText('확인'))

    // A 는 999 로 갱신, B 는 그대로, 순서는 여전히 A→B
    expect(screen.getByText('A').getAttribute('title')).toContain('999')
    expect(screen.getByText('B').getAttribute('title')).toContain('222')
    const names = Array.from(document.querySelectorAll('.tx-preset-name')).map((n) => n.textContent)
    expect(names).toEqual(['A', 'B'])
  })

  it('취소하면 프리셋이 그대로 유지된다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, 'A', '111')

    await setId(user, '999')
    await user.click(within(screen.getByText('A').closest('li')).getByText('덮어쓰기'))
    await user.click(within(screen.getByRole('alertdialog')).getByText('취소'))

    expect(screen.getByText('A').getAttribute('title')).toContain('111') // 원래 값 유지
  })
})

describe('프리셋 가져오기 전체 덮어쓰기 모드', () => {
  it('기존 프리셋이 있을 때 확인 후 전체 교체한다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '기존', 'AAA')
    await user.click(screen.getByLabelText('전체 덮어쓰기')) // replace 모드 선택

    importFile([
      { name: '새1', canId: '100', channel: 0, extended: false, rtr: false, dataStr: '01' },
      { name: '새2', canId: '200', channel: 1, extended: true, rtr: false, dataStr: 'AA' }
    ])

    // FileReader 비동기 → 확인 배너를 기다린다(아직 기존 유지)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('교체'))
    expect(screen.getByText('기존')).toBeInTheDocument()

    await user.click(within(screen.getByRole('alertdialog')).getByText('확인'))
    expect(screen.queryByText('기존')).not.toBeInTheDocument()
    expect(screen.getByText('새1')).toBeInTheDocument()
    expect(screen.getByText('새2')).toBeInTheDocument()
  })

  it('취소하면 기존 프리셋이 유지된다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await saveNew(user, '기존', 'AAA')
    await user.click(screen.getByLabelText('전체 덮어쓰기'))

    importFile([{ name: '새1', canId: '100', channel: 0, extended: false, rtr: false, dataStr: '01' }])

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    await user.click(within(screen.getByRole('alertdialog')).getByText('취소'))

    expect(screen.getByText('기존')).toBeInTheDocument()
    expect(screen.queryByText('새1')).not.toBeInTheDocument()
  })

  it('기존 프리셋이 없으면 확인 없이 즉시 교체한다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await user.click(screen.getByLabelText('전체 덮어쓰기'))
    importFile([{ name: '새1', canId: '100', channel: 0, extended: false, rtr: false, dataStr: '01' }])

    await waitFor(() => expect(screen.getByText('새1')).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
