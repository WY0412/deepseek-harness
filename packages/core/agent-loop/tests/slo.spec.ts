import { describe, expect, it, vi } from 'vitest'
import { resetTurnSlo, sloExcludeUnseen, sloFinish, sloSee, sloTurnOpen } from '../src/slo.ts'

describe('turn start lines', () => {
  it('counts the first visible event inside 30 seconds', () => {
    resetTurnSlo()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })
    const id = sloTurnOpen(0)
    sloSee(id, { type: 'reasoning-delta', text: 'think' })
    sloSee(id, { type: 'reasoning-delta', text: 'ing\n' })
    sloFinish(id, 30_000)
    sloFinish(id, 30_000)
    expect(lines).toEqual(['dsh slo: turn-open', 'dsh slo: turn-ok'])
    spy.mockRestore()
  })

  it('misses a finished turn that never became visible', () => {
    resetTurnSlo()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })
    const id = sloTurnOpen(0)
    sloSee(id, { type: 'text-delta', text: '' })
    sloFinish(id, 1_000)
    expect(lines).toEqual(['dsh slo: turn-open', 'dsh slo: turn-miss'])
    spy.mockRestore()
  })

  it('drops an unseen abort and does not also count a miss', () => {
    resetTurnSlo()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })
    const id = sloTurnOpen(0)
    sloExcludeUnseen(id)
    sloFinish(id, 60_000)
    expect(lines).toEqual(['dsh slo: turn-open', 'dsh slo: turn-drop'])
    spy.mockRestore()
  })

  it('treats a tool row as visible and a late first byte as a miss', () => {
    resetTurnSlo()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })
    const tool = sloTurnOpen(0)
    sloSee(tool, { type: 'block-start', blockType: 'tool-call' })
    sloFinish(tool, 1)
    const late = sloTurnOpen(0)
    sloSee(late, { type: 'tool-call-delta' })
    sloFinish(late, 30_001)
    expect(lines).toEqual([
      'dsh slo: turn-open',
      'dsh slo: turn-ok',
      'dsh slo: turn-open',
      'dsh slo: turn-miss',
    ])
    spy.mockRestore()
  })
})
