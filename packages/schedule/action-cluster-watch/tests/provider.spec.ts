import { Context } from '@deepseek-ai/cordis'
import { ScheduleActionRegistry, ScheduleId } from '@deepseek-ai/dsh-schedule'
import { afterEach, expect, it, vi } from 'vitest'
import provider from '../src/index.ts'

const contexts: Context[] = []
it.each([['baseline', 200], ['unchanged', 200], ['action_failed', 503]])('requests a message in always mode for %s', async (code, status) => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    outcome: 'succeeded', code, notify: false, summary: 'Snapshot result',
  }), { status }))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ScheduleActionRegistry)
  await ctx.plugin(provider, { baseUrl: 'http://mcp.test' })
  await expect(ctx.scheduleActions.execute('cluster-watch', {
    taskId: ScheduleId('task-1'), occurrenceAt: '2026-11-18T08:00:00.000Z',
    config: { cluster_id: `c${'a'.repeat(32)}`, notification_policy: 'always' },
    signal: new AbortController().signal,
  })).resolves.toMatchObject({ code, notify: true, message: expect.any(String) })
})
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('posts the admitted occurrence and maps the deterministic response', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ outcome: 'succeeded', code: 'changed', notify: true, summary: 'changed', message: '集群变化' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(ScheduleActionRegistry)
  await ctx.plugin(provider, { baseUrl: 'http://mcp.test', timeoutMs: 1_000 })
  await expect(ctx.scheduleActions.execute('cluster-watch', { taskId: ScheduleId('task-1'), occurrenceAt: '2026-11-18T08:00:00.000Z', config: { cluster_id: `c${'a'.repeat(32)}` }, signal: new AbortController().signal })).resolves.toMatchObject({ code: 'changed', notify: true })
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(init.body))).toEqual({
    schedule_id: 'task-1',
    cluster_id: `c${'a'.repeat(32)}`,
    occurrence_at: '2026-11-18T08:00:00.000Z',
  })
})
