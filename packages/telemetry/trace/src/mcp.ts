import { SpanKind, context, trace } from '@opentelemetry/api'
import { activeTurnTraceState, injectMcpTraceMeta } from './context.ts'
import { safeTraceAttributes } from './budget.ts'
import { settleSpan, startSpan, type TraceRuntime } from './runtime.ts'

export interface McpTraceInput {
  serverName: string
  toolName: string
}

/** Trace one MCP transport call and keep protocol diagnostics out of model content. */
export async function callMcpWithTrace<T>(
  runtime: TraceRuntime | undefined,
  input: McpTraceInput,
  call: (meta: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const state = activeTurnTraceState()
  if (state === undefined || !state.budget.tryConsume()) {
    return call(injectMcpTraceMeta())
  }
  const tracer = runtime?.state === 'ready' ? runtime.tracer : trace.getTracer('@deepseek-ai/dsh-trace')
  const { span, active } = startSpan(tracer, 'dsh.mcp.call', SpanKind.CLIENT, safeTraceAttributes({
    operation: 'mcp.call',
    toolName: input.toolName,
  }))
  span.setAttribute('dsh.mcp.server', input.serverName)
  try {
    const result = await context.with(active, () => call(injectMcpTraceMeta()))
    const meta = (result as { _meta?: Readonly<Record<string, unknown>> | undefined })._meta
    const used = Number(meta?.['dsh/trace-budget-used'])
    const truncated = meta?.['dsh/trace-truncated'] === true
    if (Number.isSafeInteger(used) && used >= 0 && used <= 8) {
      state.rootSpan?.setAttribute('dsh.mcp.downstream_spans_used', used)
    }
    if (truncated) state.rootSpan?.setAttribute('dsh.span_budget.truncated', true)
    const isError = (result as { isError?: boolean }).isError === true
    settleSpan(span, isError ? 'error' : 'success', isError ? { 'dsh.error.type': 'tool_error' } : {})
    return result
  } catch (error: unknown) {
    settleSpan(span, 'error', { 'dsh.error.type': 'mcp_transport' })
    throw error
  }
}
