import { SpanKind, context, type Span } from '@opentelemetry/api'
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { SpanBudget, safeTraceAttributes } from './budget.ts'
import { activeTurnTraceState, withTurnTraceState } from './context.ts'
import { settleSpan, startSpan, type TraceRuntime } from './runtime.ts'

function errorType(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'cancelled'
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  return 'internal'
}

function endOnce(span: Span): (result: 'success' | 'error' | 'cancelled', type?: string) => void {
  let ended = false
  return (result, type) => {
    if (ended) return
    ended = true
    settleSpan(span, result, type === undefined ? {} : { 'dsh.error.type': type })
  }
}

function turnResult(agent: { session: { snapshotEvents(): readonly { type: string; data: unknown }[] } }): 'success' | 'error' | 'cancelled' {
  const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  const reason = end?.data as { reason?: { kind?: string } } | undefined
  if (reason?.reason?.kind === 'aborted') return 'cancelled'
  if (reason?.reason?.kind === 'error') return 'error'
  return 'success'
}

/** Install content-safe tracing around existing native waterfalls. */
export function applyTracing(ctx: Context, runtime: TraceRuntime): void {
  if (runtime.state !== 'ready') return

  ctx.on('agent/turn', ({ agent, turn, signal }, next) => {
    const { span, active } = startSpan(runtime.tracer, 'dsh.agent.turn', SpanKind.INTERNAL, safeTraceAttributes({ operation: 'agent.turn' }))
    const finish = endOnce(span)
    const state = { budget: new SpanBudget(200), rootSpan: span }
    const recordBudget = () => {
      span.setAttribute('dsh.span_budget.used', state.budget.used)
      span.setAttribute('dsh.span_budget.dropped', state.budget.dropped)
      span.setAttribute('dsh.span_budget.truncated', state.budget.dropped > 0)
      span.setAttribute('dsh.turn', turn)
    }
    return withTurnTraceState(state, () => context.with(active, async () => {
      try {
        const more = await next()
        recordBudget()
        finish(turnResult(agent))
        return more
      } catch (error: unknown) {
        recordBudget()
        finish(signal.aborted ? 'cancelled' : 'error', errorType(error, signal))
        throw error
      }
    }))
  })

  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    const state = activeTurnTraceState()
    if (state === undefined || !state.budget.tryConsume()) return next()
    const retryAttempt = state.nextModelRetryAttempt ?? 0
    const { span, active } = startSpan(runtime.tracer, 'dsh.model.request', SpanKind.CLIENT, safeTraceAttributes({
      operation: 'model.request',
      provider: options.provider,
      model: options.model,
      retryAttempt,
    }))
    const finish = endOnce(span)
    return (async function* (): AsyncIterable<StreamChunk> {
      let iterator: AsyncIterator<StreamChunk> | undefined
      let completed = false
      let terminalFailure = false
      try {
        const stream = context.with(active, next)
        iterator = stream[Symbol.asyncIterator]()
        const activeIterator = iterator
        while (true) {
          const item = await context.with(active, () => activeIterator.next())
          if (item.done) {
            completed = true
            break
          }
          if (item.value.type === 'usage') {
            const { inputTokens, outputTokens } = item.value.usage
            if (Number.isSafeInteger(inputTokens) && inputTokens >= 0) span.setAttribute('gen_ai.usage.input_tokens', inputTokens)
            if (Number.isSafeInteger(outputTokens) && outputTokens >= 0) span.setAttribute('gen_ai.usage.output_tokens', outputTokens)
          }
          if (item.value.type === 'finish') {
            if (item.value.reason.kind === 'error') {
              terminalFailure = true
              state.nextModelRetryAttempt = retryAttempt + 1
              finish('error', 'model_error')
            } else if (item.value.reason.kind === 'aborted') {
              terminalFailure = true
              finish('cancelled', 'cancelled')
            }
          }
          yield item.value
        }
        finish('success')
        if (!terminalFailure) state.nextModelRetryAttempt = 0
      } catch (error: unknown) {
        if (!options.signal?.aborted) state.nextModelRetryAttempt = retryAttempt + 1
        finish(options.signal?.aborted ? 'cancelled' : 'error', errorType(error, options.signal))
        throw error
      } finally {
        try {
          const activeIterator = iterator
          if (activeIterator?.return !== undefined) await context.with(active, () => activeIterator.return?.())
        } finally {
          finish(options.signal?.aborted || !completed ? 'cancelled' : 'success', options.signal?.aborted || !completed ? 'cancelled' : undefined)
        }
      }
    })()
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const state = activeTurnTraceState()
    if (state === undefined || !state.budget.tryConsume()) return next()
    const { span, active } = startSpan(runtime.tracer, 'dsh.tool.execute', SpanKind.INTERNAL, safeTraceAttributes({
      operation: 'tool.execute',
      toolName: exec.name,
    }))
    const finish = endOnce(span)
    try {
      const result = await context.with(active, next)
      finish(result.isError ? 'error' : 'success', result.isError ? 'tool_error' : undefined)
      return result
    } catch (error: unknown) {
      finish(exec.signal.aborted ? 'cancelled' : 'error', errorType(error, exec.signal))
      throw error
    }
  })
}
