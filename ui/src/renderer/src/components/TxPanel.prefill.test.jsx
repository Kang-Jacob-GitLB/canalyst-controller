import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import TxPanel from './TxPanel'
import RxMonitor from './RxMonitor'

// TxPanel 의 prefill(모니터 행→폼 채우기)과 송신 프리셋 import/export 테스트.
// 기존 TxPanel.test.jsx 의 기본 송신·주기·프리셋 저장/로드 테스트와 별개로
// 추가 기능만 검증한다.

describe('TxPanel prefill(외부에서 폼 채우기)', () => {
  it('prefill 객체가 오면 폼 필드를 채운다', () => {
    const prefill = { canId: '7DF', channel: 1, extended: true, rtr: false, dataStr: 'AA BB' }
    render(<TxPanel status={{ connected: true }} onSend={() => {}} prefill={prefill} />)

    expect(screen.getByLabelText('ID(hex)')).toHaveValue('7DF')
    expect(screen.getByPlaceholderText('11 22 33')).toHaveValue('AA BB')
    expect(screen.getByLabelText('확장(EXT)')).toBeChecked()
  })

  it('prefill 이 없으면 영속 기본값을 덮어쓰지 않는다', () => {
    // prefill 미전달 마운트 시 useEffect 가 기본값(123 / 11 22 33)을 지우면 안 된다.
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    expect(screen.getByLabelText('ID(hex)')).toHaveValue('123')
    expect(screen.getByPlaceholderText('11 22 33')).toHaveValue('11 22 33')
  })

  it('같은 prefill 객체를 유지한 채 재렌더해도 사용자 편집을 덮어쓰지 않는다', async () => {
    const user = userEvent.setup()
    const prefill = { canId: '200', channel: 0, extended: false, rtr: false, dataStr: '01 02' }
    const { rerender } = render(
      <TxPanel status={{ connected: true }} onSend={() => {}} prefill={prefill} />
    )
    const idInput = screen.getByLabelText('ID(hex)')
    expect(idInput).toHaveValue('200')

    // 사용자가 폼을 수정
    await user.clear(idInput)
    await user.type(idInput, '300')
    expect(idInput).toHaveValue('300')

    // 같은 prefill 참조로 재렌더 → 참조 동등성으로 재적용 안 됨(사용자 편집 유지)
    rerender(<TxPanel status={{ connected: true }} onSend={() => {}} prefill={prefill} />)
    expect(idInput).toHaveValue('300')

    // 새 prefill 객체가 오면 다시 채워진다
    const next = { canId: '400', channel: 0, extended: false, rtr: false, dataStr: '03 04' }
    rerender(<TxPanel status={{ connected: true }} onSend={() => {}} prefill={next} />)
    expect(idInput).toHaveValue('400')
  })

  it('왕복: prefill 로 채운 폼을 송신하면 onSend 가 원래 값으로 호출된다(표준 프레임)', async () => {
    const onSend = vi.fn()
    const prefill = { canId: '123', channel: 0, extended: false, rtr: false, dataStr: '11 22 33' }
    render(<TxPanel status={{ connected: true }} onSend={onSend} prefill={prefill} />)

    await userEvent.setup().click(screen.getByText('송신'))
    expect(onSend).toHaveBeenCalledWith({
      channel: 0,
      can_id: 0x123,
      extended: false,
      rtr: false,
      data: [0x11, 0x22, 0x33]
    })
  })
})

describe('모니터 행→TX 폼 왕복(RxMonitor onUseFrame → TxPanel prefill → onSend)', () => {
  it('확장 프레임을 행 더블클릭 → prefill → 송신하면 원래 프레임이 재현된다', async () => {
    const user = userEvent.setup()
    const originalFrame = {
      _seq: 1,
      ts: 1.0,
      channel: 1,
      can_id: 0x18ff50e5,
      extended: true,
      rtr: false,
      dlc: 2,
      data: [0xde, 0xad]
    }

    // 1) RxMonitor 에서 행 더블클릭으로 TX 필드 객체를 캡처
    const onUseFrame = vi.fn()
    const { unmount } = render(
      <RxMonitor frames={[originalFrame]} onClear={() => {}} onUseFrame={onUseFrame} />
    )
    await user.dblClick(screen.getByText('0x18FF50E5'))
    const captured = onUseFrame.mock.calls[0][0]
    unmount()

    // 2) 캡처한 객체를 TxPanel prefill 로 주입하고 송신 → onSend 가 원래 프레임으로 호출
    const onSend = vi.fn()
    render(<TxPanel status={{ connected: true }} onSend={onSend} prefill={captured} />)
    await user.click(screen.getByText('송신'))

    expect(onSend).toHaveBeenCalledWith({
      channel: 1,
      can_id: 0x18ff50e5,
      extended: true,
      rtr: false,
      data: [0xde, 0xad]
    })
  })
})

describe('TxPanel 프리셋 import/export', () => {
  beforeEach(() => {
    // jsdom 에 없는 URL.createObjectURL/revokeObjectURL 을 stub
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn()
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 프리셋 1개를 폼에 저장해 목록에 띄우는 헬퍼
  async function savePresetNamed(user, name, id = '7DF') {
    const idInput = screen.getByLabelText('ID(hex)')
    await user.clear(idInput)
    await user.type(idInput, id)
    await user.type(screen.getByPlaceholderText('엔진 RPM 요청'), name)
    await user.click(screen.getByText('프리셋 저장'))
  }

  it('프리셋이 없으면 내보내기 버튼이 비활성화된다', () => {
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    expect(screen.getByText('프리셋 내보내기')).toBeDisabled()
  })

  it('프리셋 내보내기 클릭 시 다운로드(<a download> 클릭)를 트리거한다', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    await savePresetNamed(user, '내보내기대상')
    await user.click(screen.getByText('프리셋 내보내기'))

    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('프리셋 가져오기: JSON 파일을 읽어 기존 목록에 병합한다', async () => {
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    const imported = [
      { name: '가져온1', canId: '100', channel: 0, extended: false, rtr: false, dataStr: '01' },
      { name: '가져온2', canId: '200', channel: 1, extended: true, rtr: false, dataStr: 'AA BB' }
    ]
    const file = new File([JSON.stringify(imported)], 'presets.json', { type: 'application/json' })

    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [file] } })

    // FileReader 는 비동기 → 병합 결과를 기다린다
    await waitFor(() => expect(screen.getByText('가져온1')).toBeInTheDocument())
    expect(screen.getByText('가져온2')).toBeInTheDocument()
  })

  it('동일 이름 프리셋은 가져온 값으로 덮어쓴다', async () => {
    const user = userEvent.setup()
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)

    // 기존 프리셋 "공통" 저장(ID 7DF)
    await savePresetNamed(user, '공통', '7DF')
    expect(screen.getByText('공통')).toBeInTheDocument()

    // 같은 이름 "공통"을 다른 값(ID 555)으로 가져오기
    const imported = [
      { name: '공통', canId: '555', channel: 0, extended: false, rtr: false, dataStr: 'FF' }
    ]
    const file = new File([JSON.stringify(imported)], 'presets.json', { type: 'application/json' })
    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [file] } })

    // 병합은 비동기(FileReader) → merge 로 바뀌는 값(title 의 새 ID 555)을 기다린다.
    // getByText('공통') 은 병합 전/후 항상 1개라 waitFor 안에서 throw 하지 않는다.
    await waitFor(() => {
      expect(screen.getByText('공통').getAttribute('title')).toContain('555')
    })
    // 덮어쓰기이므로 "공통" 행은 여전히 하나만 존재해야 한다(중복 추가 아님)
    expect(screen.getAllByText('공통')).toHaveLength(1)
  })

  it('잘못된 형식(배열 아님)은 오류를 표시하고 병합하지 않는다', async () => {
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    const bad = JSON.stringify({ not: 'an array' })
    const file = new File([bad], 'bad.json', { type: 'application/json' })
    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByText(/프리셋 파일 형식이 올바르지 않습니다/)).toBeInTheDocument()
    )
  })

  it('JSON 파싱 오류는 오류 메시지를 표시한다', async () => {
    render(<TxPanel status={{ connected: true }} onSend={() => {}} />)
    const file = new File(['{ this is not json'], 'broken.json', { type: 'application/json' })
    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByText(/JSON 파싱 오류|읽을 수 없습니다/)).toBeInTheDocument()
    )
  })
})
