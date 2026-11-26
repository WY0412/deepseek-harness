import type { Context } from '@deepseek-ai/cordis'
import type { ScheduleActionResult } from '@deepseek-ai/dsh-schedule'
import { z } from 'zod'

const response = z.object({
  outcome: z.enum(['succeeded', 'failed']), code: z.string().min(1), notify: z.boolean(),
  summary: z.string().max(500), message: z.string().min(1).max(2000).nullable().optional(),
}).passthrough()

const taskConfig = z.object({
  cluster_id: z.string().regex(/^c[a-z0-9]{32}$/u),
  notification_policy: z.enum(['changes', 'always']).optional(),
}).strict()

/** Provider configuration. */
export interface Config {
  /** Origin of the lease-authenticated MCP internal HTTP service. */
  readonly baseUrl: string
  /** Maximum duration of one cluster snapshot HTTP request. */
  readonly timeoutMs?: number
}
export const name = 'schedule-action-cluster-watch'
export const inject = ['scheduleActions']
export const Config = z.object({ baseUrl: z.url(), timeoutMs: z.number().int().positive().default(20_000) })

/** Register the deterministic cluster-watch action provider. */
export function apply(ctx: Context, config: Config): void {
  const baseUrl = config.baseUrl.replace(/\/$/u, '')
  ctx.effect(() => ctx.scheduleActions.register({
    id: 'cluster-watch', title: 'ACK cluster watch',
    config: taskConfig,
    async execute(request): Promise<ScheduleActionResult> {
      const actionConfig = taskConfig.parse(request.config)
      const always = actionConfig.notification_policy === 'always'
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new Error('cluster watch action timeout')),
        config.timeoutMs ?? 20_000,
      )
      try {
        const result = await fetch(`${baseUrl}/automation/cluster-watch/check`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schedule_id: request.taskId,
            cluster_id: actionConfig.cluster_id,
            occurrence_at: request.occurrenceAt,
          }),
          signal: AbortSignal.any([request.signal, controller.signal]),
        })
        if (!result.ok) throw new Error(`cluster watch HTTP ${result.status}`)
        const parsed = response.parse(await result.json())
        return {
          outcome: parsed.outcome,
          code: parsed.code,
          notify: parsed.notify || always,
          summary: parsed.summary,
          ...(parsed.message != null ? { message: parsed.message } : always
            ? { message: `ACK 集群定时快照（${actionConfig.cluster_id}）\n${parsed.code}：${parsed.summary || '无摘要'}` }
            : {}),
        }
      } catch (error) {
        if (!always || request.signal.aborted) throw error
        const summary = 'ACK 集群定时快照执行失败，请查看任务运行记录。'
        return { outcome: 'failed', code: 'action_failed', notify: true, summary, message: summary }
      } finally { clearTimeout(timer) }
    },
  }))
}

export default Object.assign(apply, { inject, Config })
