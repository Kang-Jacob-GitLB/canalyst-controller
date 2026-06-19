import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DbcTxPanel from './DbcTxPanel'

// 테스트용 DBC 메시지 정의(코어 계약 형식과 동일)
const MESSAGES = [
  {
    name: 'EngineData',
    frame_id: 0x100,
    is_extended: false,
    length: 8,
    signals: [
      { name: 'RPM', minimum: 0, maximum: 8000, unit: 'rpm' },
      { name: 'Temp', minimum: -40, maximum: 215, unit: 'degC' }
    ]
  }
]

describe('DbcTxPanel', () => {
  it('"DBC 메시지 새로고침" 클릭 시 onListMessages 를 호출한다', async () => {
    const onListMessages = vi.fn()
    render(
      <DbcTxPanel
        dbcMessages={[]}
        onListMessages={onListMessages}
        onEncodeSend={() => {}}
        connected={true}
      />
    )
    await userEvent.setup().click(screen.getByText('DBC 메시지 새로고침'))
    expect(onListMessages).toHaveBeenCalledTimes(1)
  })

  it('메시지를 선택하면 모든 신호 입력이 기본값(minimum)으로 prefill 되어 렌더된다', async () => {
    const user = userEvent.setup()
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={() => {}}
        connected={true}
      />
    )

    await user.selectOptions(screen.getByLabelText('메시지'), 'EngineData')

    // type="number" 입력은 숫자로 비교된다(문자열 아님)
    expect(screen.getByLabelText('RPM')).toHaveValue(0) // minimum 0
    expect(screen.getByLabelText('Temp')).toHaveValue(-40) // minimum 음수도 ?? 0 으로 덮이지 않음
  })

  it('미연결 시 인코딩 송신 버튼이 비활성화된다', async () => {
    const user = userEvent.setup()
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={() => {}}
        connected={false}
      />
    )
    await user.selectOptions(screen.getByLabelText('메시지'), 'EngineData')
    expect(screen.getByText('인코딩 송신')).toBeDisabled()
  })

  it('메시지 미선택 시 인코딩 송신 버튼이 비활성화된다', () => {
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={() => {}}
        connected={true}
      />
    )
    expect(screen.getByText('인코딩 송신')).toBeDisabled()
  })

  it('목록 미로드(빈 배열) 시 인코딩 송신 버튼이 비활성화된다', () => {
    render(
      <DbcTxPanel
        dbcMessages={[]}
        onListMessages={() => {}}
        onEncodeSend={() => {}}
        connected={true}
      />
    )
    expect(screen.getByText('인코딩 송신')).toBeDisabled()
  })

  it('입력을 건드리지 않고 송신해도 onEncodeSend 가 완전한 숫자 signals dict 로 호출된다', async () => {
    const onEncodeSend = vi.fn()
    const user = userEvent.setup()
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={onEncodeSend}
        connected={true}
      />
    )

    await user.selectOptions(screen.getByLabelText('메시지'), 'EngineData')
    await user.click(screen.getByText('인코딩 송신'))

    // 두 신호 모두 기본값(minimum)으로 채워진 완전한 dict, 채널 0
    expect(onEncodeSend).toHaveBeenCalledWith('EngineData', { RPM: 0, Temp: -40 }, 0)
  })

  it('입력값을 바꾸면 그 값이 숫자로 인코딩 송신된다', async () => {
    const onEncodeSend = vi.fn()
    const user = userEvent.setup()
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={onEncodeSend}
        connected={true}
      />
    )

    await user.selectOptions(screen.getByLabelText('메시지'), 'EngineData')

    const rpm = screen.getByLabelText('RPM')
    await user.clear(rpm)
    await user.type(rpm, '1500')

    await user.click(screen.getByText('인코딩 송신'))
    // 입력은 문자열이지만 계약은 number → Number() 변환 검증
    expect(onEncodeSend).toHaveBeenCalledWith('EngineData', { RPM: 1500, Temp: -40 }, 0)
  })

  it('송신 후 송신 피드백(송신됨: ...)을 표시한다', async () => {
    const user = userEvent.setup()
    render(
      <DbcTxPanel
        dbcMessages={MESSAGES}
        onListMessages={() => {}}
        onEncodeSend={() => {}}
        connected={true}
      />
    )
    await user.selectOptions(screen.getByLabelText('메시지'), 'EngineData')
    await user.click(screen.getByText('인코딩 송신'))
    expect(screen.getByText(/송신됨: EngineData/)).toBeInTheDocument()
  })
})
