import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ToolsPanel from './ToolsPanel'

const noop = () => {}
const baseProps = {
  filterIds: null,
  filterMeta: null,
  logStatus: null,
  exportStatus: null,
  onSetFilter: noop,
  onExportLog: noop,
  onStartLog: noop,
  onStopLog: noop,
  onReplay: noop,
  onLoadDbc: noop
}

describe('ToolsPanel', () => {
  it('hex 콤마구분 입력을 정수 배열로 파싱해 onSetFilter 를 호출한다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    // 트레일링 콤마/여분 공백이 있어도 빈 토큰을 버리고 파싱
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), '100, 7FF, ')
    await user.click(screen.getByText('필터 적용'))
    // 마스크 빈칸→undefined(정확일치), 채널 전체→null
    expect(onSetFilter).toHaveBeenCalledWith([0x100, 0x7ff], undefined, null)
  })

  it('빈 입력은 전체 통과(빈 배열)로 전송한다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    await userEvent.setup().click(screen.getByText('필터 적용'))
    expect(onSetFilter).toHaveBeenCalledWith([], undefined, null)
  })

  it('잘못된 hex 는 오류를 표시하고 onSetFilter 를 호출하지 않는다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), 'ZZZ')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).not.toHaveBeenCalled()
    expect(screen.getByText(/잘못된 ID/)).toBeInTheDocument()
  })

  it('현재 필터를 hex 로 라운드트립 표시한다(빈 배열은 전체 통과)', () => {
    const { rerender } = render(<ToolsPanel {...baseProps} filterIds={[0x100, 0x7ff]} />)
    expect(screen.getByText(/100, 7FF/)).toBeInTheDocument()
    rerender(<ToolsPanel {...baseProps} filterIds={[]} />)
    expect(screen.getByText(/전체 통과/)).toBeInTheDocument()
  })

  it('로깅 중이면 중지 버튼과 기록 상태를 표시한다', () => {
    render(<ToolsPanel {...baseProps} logStatus={{ logging: true, path: '/tmp/a.log' }} />)
    expect(screen.getByText('로깅 중지')).toBeInTheDocument()
    expect(screen.getByText(/기록 중/)).toBeInTheDocument()
  })

  it('찾아보기 버튼이 파일 다이얼로그 경로를 입력에 채운다', async () => {
    window.canctl = {
      pickOpenFile: vi.fn().mockResolvedValue('C:\\sel\\vehicle.dbc'),
      pickSaveFile: vi.fn().mockResolvedValue('C:\\sel\\out.jsonl')
    }
    try {
      render(<ToolsPanel {...baseProps} />)
      const browse = screen.getAllByText('찾아보기')
      expect(browse).toHaveLength(5) // 로그 / 재생 / DBC / 내보내기 src / 내보내기 dest
      await userEvent.setup().click(browse[2]) // DBC 찾아보기
      expect(window.canctl.pickOpenFile).toHaveBeenCalled()
      expect(screen.getByDisplayValue('C:\\sel\\vehicle.dbc')).toBeInTheDocument()
    } finally {
      delete window.canctl
    }
  })

  it('마스크(hex)와 채널을 입력해 적용하면 onSetFilter 에 정수 mask·channel 을 넘긴다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), '100')
    await user.type(screen.getByPlaceholderText('7FF'), '700')
    // 채널 select 의 첫 콤보박스가 채널(전체/0/1)
    await user.selectOptions(screen.getAllByRole('combobox')[0], '1')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).toHaveBeenCalledWith([0x100], 0x700, 1)
  })

  it('채널 0 선택은 falsy 가 아닌 정수 0 으로 넘어간다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('100, 200, 7FF'), '200')
    await user.selectOptions(screen.getAllByRole('combobox')[0], '0')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).toHaveBeenCalledWith([0x200], undefined, 0)
  })

  it('잘못된 마스크 hex 는 오류를 표시하고 onSetFilter 를 호출하지 않는다', async () => {
    const onSetFilter = vi.fn()
    render(<ToolsPanel {...baseProps} onSetFilter={onSetFilter} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('7FF'), 'GG')
    await user.click(screen.getByText('필터 적용'))
    expect(onSetFilter).not.toHaveBeenCalled()
    expect(screen.getByText(/잘못된 마스크/)).toBeInTheDocument()
  })

  it('filterMeta 의 mask·channel 을 현재 필터 표시에 반영한다', () => {
    render(
      <ToolsPanel
        {...baseProps}
        filterIds={[0x100]}
        filterMeta={{ mask: 0x7ff, channel: 0 }}
      />
    )
    expect(screen.getByText(/마스크 7FF/)).toBeInTheDocument()
    expect(screen.getByText(/채널 0/)).toBeInTheDocument()
  })

  it('filterMeta 의 channel 이 null 이면 전체로 표시하고 mask 없으면 마스크 표기를 생략한다', () => {
    render(
      <ToolsPanel
        {...baseProps}
        filterIds={[]}
        filterMeta={{ mask: undefined, channel: null }}
      />
    )
    expect(screen.getByText(/채널 전체/)).toBeInTheDocument()
    // "· 마스크" 는 상태표시 줄에만 등장(입력 label "마스크(hex..)" 와 구분)
    expect(screen.queryByText(/· 마스크/)).not.toBeInTheDocument()
  })

  it('내보내기 버튼은 src·dest 입력 후 onExportLog 를 src·dest·format 으로 호출한다', async () => {
    const onExportLog = vi.fn()
    render(<ToolsPanel {...baseProps} onExportLog={onExportLog} />)
    const user = userEvent.setup()
    // placeholder 는 JSX 에서 백슬래시가 escape 되지 않아 조회가 까다로워 label 로 조회한다.
    await user.type(screen.getByLabelText('내보낼 로그(JSONL)'), 'C:\\in.jsonl')
    await user.type(screen.getByLabelText('저장 경로'), 'C:\\out.csv')
    // 포맷 select 가 두 번째 콤보박스(채널 다음). CSV 선택.
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'csv')
    await user.click(screen.getByText('내보내기'))
    expect(onExportLog).toHaveBeenCalledWith('C:\\in.jsonl', 'C:\\out.csv', 'csv')
  })

  it('exportStatus 성공 시 개수와 경로를 표시한다', () => {
    render(
      <ToolsPanel
        {...baseProps}
        exportStatus={{ ok: true, path: 'C:\\out.asc', count: 42, format: 'asc' }}
      />
    )
    expect(screen.getByText(/42개 내보냄 → C:\\out.asc/)).toBeInTheDocument()
  })
})
