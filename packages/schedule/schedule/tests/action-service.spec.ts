import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ScheduleInputError } from '../src/domain.ts'
import { harness } from './harness.ts'

const contexts: Context[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T08:00:00.000Z'))
})
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.useRealTimers()
})

it('creates a validated recurring action with skip policy and exposes typed task metadata', async () => {
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({ cluster: z.string().min(1), notification_policy: z.enum(['changes', 'always']).optional() }).strict(),
        execute: async () => ({ outcome: 'succeeded', code: 'ok', summary: 'ok', notify: false }),
      })
    } })
  const sessionId = SessionId('action-owner')
  const created = await test.service.createAction(sessionId, {
    title: 'Production cluster', every_seconds: 300,
    execution: {
      kind: 'action', provider: 'cluster-watch', config: { cluster: 'prod' },
      destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' },
    },
  })
  expect(created).toMatchObject({
    title: 'Production cluster', status: 'active', paused: false, missedRunPolicy: 'skip',
    execution: { kind: 'action', provider: 'cluster-watch', config: { cluster: 'prod' } },
    executionHistory: [],
  })
  expect(await test.service.taskCatalog()).toEqual([created])
  const { sessionId: _owner, status: _status, paused: _paused, missedRunPolicy: _missed, execution: _execution,
    executionHistory: _history, lastExecution: _last, lastDelivery: _delivery, ...expected } = created
  const policy = { sessionId, id: created.id, expected }
  expect(await test.service.update({ ...policy, notificationPolicy: { expected: 'changes', value: 'always' } }))
    .toMatchObject({ updated: true })
  expect(await test.service.taskCatalog()).toEqual([{
    ...created, execution: { ...created.execution, config: { cluster: 'prod', notification_policy: 'always' } },
  }])
  expect(await test.service.update({ ...policy, notificationPolicy: { expected: 'changes', value: 'always' } }))
    .toMatchObject({ updated: false, code: 'schedule_conflict' })
  expect(await test.service.update({ ...policy, notificationPolicy: { expected: 'always', value: 'changes' } }))
    .toMatchObject({ updated: true })
  expect(await test.service.catalog()).toEqual([expect.objectContaining({
    id: created.id, sessionId, status: 'active',
  })])
})

it('rejects unavailable providers and invalid provider configuration without writing a task', async () => {
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({ cluster: z.string().min(1) }).strict(),
        execute: async () => ({ outcome: 'succeeded', code: 'ok', summary: 'ok', notify: false }),
      })
    } })
  const destination = { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' }
  await expect(test.service.createAction(SessionId('owner'), {
    title: 'Missing', every_seconds: 300,
    execution: { kind: 'action', provider: 'missing', config: {}, destination },
  })).rejects.toBeInstanceOf(ScheduleInputError)
  await expect(test.service.createAction(SessionId('owner'), {
    title: 'Invalid', every_seconds: 300,
    execution: { kind: 'action', provider: 'cluster-watch', config: { cluster: '' }, destination },
  })).rejects.toThrow(/cluster/)
  expect(await test.service.taskCatalog()).toEqual([])
})
