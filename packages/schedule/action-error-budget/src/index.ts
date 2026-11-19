import type { Context } from '@deepseek-ai/cordis'
import type { ScheduleActionResult } from '@deepseek-ai/dsh-schedule'
import { z } from 'zod'

const response = z.object({ outcome: z.enum(['succeeded', 'failed']), code: z.string().min(1), notify: z.boolean(), summary: z.string().max(500), message: z.string().min(1).max(2000).nullable().optional() }).strict()

/** Provider configuration. */
export interface Config {
  /** Origin of the lease-authenticated MCP internal HTTP service. */
  readonly baseUrl: string
  /** Maximum duration of one error-budget HTTP request. */
  readonly timeoutMs?: number
}
export const name = 'schedule-action-error-budget'
export const inject = ['scheduleActions']
export const Config = z.object({ baseUrl: z.url(), timeoutMs: z.number().int().positive().default(15_000) })

/** Register the deterministic error-budget action provider. */
export function apply(ctx: Context, config: Config): void {
  const baseUrl = config.baseUrl.replace(/\/$/u, '')
  ctx.effect(() => ctx.scheduleActions.register({
    id: 'error-budget', title: 'DSH error budget', config: z.object({}).strict(),
    async execute(request): Promise<ScheduleActionResult> {
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new Error('error budget action timeout')),
        config.timeoutMs ?? 15_000,
      )
      try {
        const result = await fetch(`${baseUrl}/automation/error-budget/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.any([request.signal, controller.signal]),
        })
        if (!result.ok) throw new Error(`error budget HTTP ${result.status}`)
        const parsed = response.parse(await result.json())
        return {
          outcome: parsed.outcome,
          code: parsed.code,
          notify: parsed.notify,
          summary: parsed.summary,
          ...(parsed.message == null ? {} : { message: parsed.message }),
        }
      } finally { clearTimeout(timer) }
    },
  }))
}

export default Object.assign(apply, { inject, Config })
