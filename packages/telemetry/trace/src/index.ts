import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyTracing } from './plugin.ts'
import { createTraceRuntime, type TraceConfig } from './runtime.ts'

export const name = 'trace'
export const inject = ['llm', 'tools']

export interface Config extends TraceConfig {}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string(),
  headers: z.union([z.string(), z.dict(z.string())]),
  serviceName: z.string().default('dsh-harness'),
  resourceAttributes: z.dict(z.string()),
})

export function apply(ctx: Context, config: Config): void {
  const runtime = createTraceRuntime(config)
  if (runtime.state === 'config_invalid') {
    ctx.logger.warn(`trace runtime state=config_invalid diagnostic=${runtime.diagnostic ?? 'unknown'}`)
  }
  applyTracing(ctx, runtime)
  ctx.effect(() => () => runtime.shutdown())
}

export { SpanBudget, safeTraceAttributes } from './budget.ts'
export { activeTurnTraceState, injectMcpTraceMeta, withTurnTraceState } from './context.ts'
export { applyTracing } from './plugin.ts'
export { callMcpWithTrace } from './mcp.ts'
export type { McpTraceInput } from './mcp.ts'
export { createTraceRuntime, parseOtlpHeaders, safeResourceAttributes, settleSpan, startSpan } from './runtime.ts'
export type { TraceConfig, TraceDiagnostics, TraceRuntime, TraceRuntimeOptions, TraceRuntimeState } from './runtime.ts'
