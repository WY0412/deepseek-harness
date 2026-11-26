import { describe, expect, it } from 'vitest'
import { SpanBudget, safeTraceAttributes } from '../src/budget.ts'

describe('SpanBudget', () => {
  it('reserves downstream capacity without allowing the total to exceed the turn limit', async () => {
    const budget = new SpanBudget(10)

    expect(budget.tryConsume()).toBe(true)
    expect(budget.reserveUpTo(8)).toBe(8)
    expect(budget.reserveUpTo(8)).toBe(1)
    expect(budget.tryConsume()).toBe(false)
    expect(budget.used).toBe(10)
    expect(budget.dropped).toBe(8)
  })

  it('serializes parallel reservations through one atomic event-loop update', async () => {
    const budget = new SpanBudget(20)

    const reservations = await Promise.all(Array.from({ length: 8 }, async () => budget.reserveUpTo(8)))

    expect(reservations.reduce((sum, value) => sum + value, 0)).toBe(20)
    expect(reservations.every(value => value >= 0 && value <= 8)).toBe(true)
    expect(budget.used).toBe(20)
  })
})

describe('safeTraceAttributes', () => {
  it('emits only the fixed allowlist and removes sensitive dynamic values', () => {
    const attributes = safeTraceAttributes({
      operation: 'dsh.model.request',
      result: 'error',
      errorType: 'model_upstream',
      provider: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 12,
      outputTokens: 7,
      toolName: 'ack_health_snapshot',
      unsafe: {
        prompt: 'CANARY-PROMPT',
        path: '/workspace/CANARY-PATH',
        authorization: 'Bearer CANARY-SECRET',
      },
    })

    expect(attributes).toEqual({
      'dsh.operation': 'dsh.model.request',
      'dsh.result': 'error',
      'dsh.error.type': 'model_upstream',
      'gen_ai.provider.name': 'deepseek',
      'gen_ai.request.model': 'deepseek-chat',
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 7,
      'gen_ai.tool.name': 'ack_health_snapshot',
    })
    expect(JSON.stringify(attributes)).not.toContain('CANARY')
  })
})
