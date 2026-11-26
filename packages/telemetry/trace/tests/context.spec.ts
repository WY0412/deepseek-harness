import { context, trace, TraceFlags } from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'
import { SpanBudget } from '../src/budget.ts'
import { injectMcpTraceMeta, withTurnTraceState } from '../src/context.ts'
import { safeResourceAttributes } from '../src/runtime.ts'

describe('MCP trace metadata', () => {
  it('drops resource attributes outside the fixed privacy allowlist', () => {
    expect(safeResourceAttributes({
      'deployment.environment': 'test',
      'cloud.region': 'cn-hangzhou',
      'user.id': 'SECRET_USER',
      'internal.url': 'SECRET_URL',
    })).toEqual({
      'deployment.environment': 'test',
      'cloud.region': 'cn-hangzhou',
    })
  })
  it('injects the active W3C parent and atomically reserves at most eight downstream spans', async () => {
    const budget = new SpanBudget(12)
    const active = trace.setSpanContext(context.active(), {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: TraceFlags.SAMPLED,
    })

    const [first, second] = await withTurnTraceState({ budget }, async () => [
      injectMcpTraceMeta({ existing: 'kept' }, active),
      injectMcpTraceMeta({}, active),
    ])

    expect(first).toEqual({
      existing: 'kept',
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      'dsh/trace-budget': 8,
    })
    expect(second['dsh/trace-budget']).toBe(4)
    expect(budget.used).toBe(12)
  })

  it('does not emit trace headers without a valid active span context', () => {
    const budget = new SpanBudget(8)
    const meta = withTurnTraceState({ budget }, () => injectMcpTraceMeta())

    expect(meta).toEqual({ 'dsh/trace-budget': 8 })
  })
})
