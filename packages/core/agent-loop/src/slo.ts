const LIMIT_MS = 30_000

interface OpenTurn {
  at: number
  saw: boolean
  reasoning: string
  closed: boolean
}

const turns = new Map<number, OpenTurn>()
let seq = 0

export function resetTurnSlo(): void {
  turns.clear()
  seq = 0
}

export function sloTurnOpen(now = Date.now()): number {
  const id = ++seq
  turns.set(id, { at: now, saw: false, reasoning: '', closed: false })
  console.log('dsh slo: turn-open')
  return id
}

export interface SloChunk {
  type: string
  text?: string
  blockType?: string
}

/** First visible event: body text, a tool row, or a thinking-preview line. */
export function sloSee(id: number | undefined, chunk: SloChunk): void {
  const turn = id === undefined ? undefined : turns.get(id)
  if (turn === undefined || turn.closed || turn.saw) return
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
    turn.saw = true
    return
  }
  if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')) {
    turn.saw = true
    return
  }
  if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
    turn.reasoning += chunk.text
    if (turn.reasoning.includes('\n')) turn.saw = true
  }
}

export function sloExcludeUnseen(id: number | undefined): void {
  if (id === undefined) return
  const turn = turns.get(id)
  if (turn === undefined || turn.closed || turn.saw) return
  turn.closed = true
  turns.delete(id)
  console.log('dsh slo: turn-drop')
}

export function sloFinish(id: number | undefined, now = Date.now()): void {
  if (id === undefined) return
  const turn = turns.get(id)
  if (turn === undefined || turn.closed) return
  turn.closed = true
  turns.delete(id)
  const started = turn.saw && now - turn.at <= LIMIT_MS
  console.log(started ? 'dsh slo: turn-ok' : 'dsh slo: turn-miss')
}

export function sloLooksUnconfigured(text: string): boolean {
  return /credential|api[ _-]?key|unauthorized|\b401\b/i.test(text)
}
