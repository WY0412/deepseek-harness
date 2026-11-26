import { describe, expect, it, vi } from 'vitest'
import { SpanBudget } from '../src/budget.ts'
import { withTurnTraceState } from '../src/context.ts'
import { callMcpWithTrace } from '../src/mcp.ts'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import { createTraceRuntime } from '../src/runtime.ts'

describe('MCP distributed span budget', () => {
  it('atomically consumes one client span and reserves at most eight downstream spans', async () => {
    const budget = new SpanBudget(10)
    const call = vi.fn(async (meta: Record<string, unknown>) => ({
      _meta: { 'dsh/trace-budget-used': 3, 'dsh/trace-truncated': false },
      meta,
    }))

    const result = await withTurnTraceState({ budget }, () => callMcpWithTrace(undefined, {
      serverName: 'ack',
      toolName: 'health_snapshot',
    }, call))

    expect(result.meta['dsh/trace-budget']).toBe(8)
    expect(budget.used).toBe(9)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('does not refund a reservation when transport fails', async () => {
    const budget = new SpanBudget(20)
    await expect(withTurnTraceState({ budget }, () => callMcpWithTrace(undefined, {
      serverName: 'ack',
      toolName: 'health_snapshot',
    }, async () => { throw new Error('sensitive transport detail') }))).rejects.toThrow()

    expect(budget.used).toBe(9)
  })

  it('marks an MCP logical error result as an error span', async () => {
    const exporter = new InMemorySpanExporter()
    const runtime = createTraceRuntime({ enabled: true, serviceName: 'test' }, { exporter, registerGlobal: false })
    await withTurnTraceState({ budget: new SpanBudget(20) }, () => callMcpWithTrace(runtime, {
      serverName: 'ack',
      toolName: 'search_traces',
    }, async () => ({ isError: true, content: [] })))
    await runtime.forceFlush()
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      'dsh.result': 'error',
      'dsh.error.type': 'tool_error',
    })
    await runtime.shutdown()
  })
})
