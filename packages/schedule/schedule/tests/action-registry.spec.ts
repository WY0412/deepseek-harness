import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { afterEach, expect, it, vi } from 'vitest'
import { ScheduleActionRegistry } from '../src/action-registry.ts'
import { ScheduleId } from '../src/domain.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function registry() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ScheduleActionRegistry)
  return { ctx, actions: ctx.scheduleActions }
}

it('registers one provider, validates config, and forwards the cancellation signal', async () => {
  const test = await registry()
  const execute = vi.fn(async () => ({
    outcome: 'succeeded' as const, code: 'healthy', summary: 'Healthy', notify: false,
  }))
  const dispose = test.actions.register({
    id: 'cluster-watch', title: 'Cluster watch',
    config: z.object({ cluster: z.string().min(1) }).strict(), execute,
  })
  const signal = new AbortController().signal
  await expect(test.actions.execute('cluster-watch', {
    taskId: ScheduleId('task-1'), occurrenceAt: '2026-11-18T08:00:00.000Z',
    config: { cluster: 'prod' }, signal,
  })).resolves.toEqual({ outcome: 'succeeded', code: 'healthy', summary: 'Healthy', notify: false })
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    taskId: 'task-1', occurrenceAt: '2026-11-18T08:00:00.000Z', config: { cluster: 'prod' }, signal,
  })
  expect(() => test.actions.validate('cluster-watch', { cluster: '' })).toThrow(/cluster/)
  dispose()
  expect(test.actions.get('cluster-watch')).toBeUndefined()
})

it('rejects duplicate providers without replacing the first registration', async () => {
  const test = await registry()
  const first = {
    id: 'cluster-watch', title: 'Cluster watch', config: z.object({}).strict(),
    execute: vi.fn(async () => ({ outcome: 'succeeded' as const, code: 'ok', summary: '', notify: false })),
  }
  test.actions.register(first)
  expect(() => test.actions.register({ ...first, title: 'Replacement' }))
    .toThrow('schedule action provider "cluster-watch" is already registered')
  expect(test.actions.get('cluster-watch')?.title).toBe('Cluster watch')
})

it('rejects unknown providers before execution', async () => {
  const test = await registry()
  await expect(test.actions.execute('missing', {
    taskId: ScheduleId('task-1'), occurrenceAt: '2026-11-18T08:00:00.000Z', config: {},
    signal: new AbortController().signal,
  })).rejects.toThrow('schedule action provider "missing" is unavailable')
})
