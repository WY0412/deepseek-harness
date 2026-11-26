import { AsyncLocalStorage } from 'node:async_hooks'
import { context, isSpanContextValid, trace } from '@opentelemetry/api'
import type { Context } from '@opentelemetry/api'
import type { Span } from '@opentelemetry/api'
import type { SpanBudget } from './budget.ts'

const turnTraceState = new AsyncLocalStorage<TurnTraceState>()

export interface TurnTraceState {
  budget: SpanBudget
  rootSpan?: Span
  nextModelRetryAttempt?: number
}

export function withTurnTraceState<T>(state: TurnTraceState, operation: () => T): T {
  return turnTraceState.run(state, operation)
}

export function activeTurnTraceState(): TurnTraceState | undefined {
  return turnTraceState.getStore()
}

export function injectMcpTraceMeta(
  existing: Readonly<Record<string, unknown>> = {},
  activeContext: Context = context.active(),
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...existing }
  const spanContext = trace.getSpanContext(activeContext)
  if (spanContext !== undefined && isSpanContextValid(spanContext)) {
    const flags = spanContext.traceFlags.toString(16).padStart(2, '0')
    output.traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`
    if (spanContext.traceState !== undefined) output.tracestate = spanContext.traceState.serialize()
  }
  const state = activeTurnTraceState()
  if (state !== undefined) output['dsh/trace-budget'] = state.budget.reserveUpTo(8)
  return output
}
