import { Context } from '@deepseek-ai/cordis'
import { ScheduleActionRegistry, ScheduleId } from '@deepseek-ai/dsh-schedule'
import { afterEach, expect, it, vi } from 'vitest'
import provider from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('preserves a failed budget read without inventing a notification', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ outcome: 'failed', code: 'prometheus_unavailable', notify: false, summary: '读取失败', message: null }), { status: 200 })))
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(ScheduleActionRegistry)
  await ctx.plugin(provider, { baseUrl: 'http://mcp.test', timeoutMs: 1_000 })
  await expect(ctx.scheduleActions.execute('error-budget', { taskId: ScheduleId('task-2'), occurrenceAt: '2026-11-18T08:00:00.000Z', config: {}, signal: new AbortController().signal })).resolves.toEqual({ outcome: 'failed', code: 'prometheus_unavailable', notify: false, summary: '读取失败' })
})
