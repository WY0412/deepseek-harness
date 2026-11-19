import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEveryScheduleRecord, ScheduleId } from '../src/domain.ts'
import { scheduleDomain, type ScheduleTask } from '../src/storage.ts'
import type { ScheduleRecord } from '../src/types.ts'
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

async function setup(options: Parameters<typeof harness>[0] = {}) {
  return harness({ ...options, onContext: ctx => contexts.push(ctx) })
}

function table(test: Awaited<ReturnType<typeof setup>>) {
  const domain = test.ctx.storageDomain.get('schedule')
  if (domain === undefined) throw new Error('Schedule domain not initialized')
  return domain.table('tasks') as KvTable<ScheduleRecord['id'], ScheduleTask>
}

it('advances a startup-missed skip task without restoring its Session or creating execution history', async () => {
  const sessionId = SessionId('skip-owner')
  const record = createEveryScheduleRecord(
    ScheduleId('skip-task'), 'Skip missed', 300, Date.parse('2026-11-18T07:00:00.000Z'), 'Skip missed',
  )
  const test = await setup({ beforeService: async (_ctx, facility) => {
    const domain = await facility.open(scheduleDomain)
    await domain.table('tasks').put(record.id, {
      sessionId, record: { ...record, scheduledAt: '2026-11-18T07:05:00.000Z' }, status: 'active',
      missedRunPolicy: 'skip', deliveryHistory: { records: [], earlierRecordsUnavailable: false },
    })
    await domain.close()
  } })
  await vi.advanceTimersByTimeAsync(0)
  expect(table(test).get(record.id)).toMatchObject({
    record: { scheduledAt: '2026-11-18T08:05:00.000Z' }, status: 'active',
  })
  expect(table(test).get(record.id)?.executionHistory).toBeUndefined()
  expect(test.resolve).not.toHaveBeenCalled()
})

it('pauses through the management FIFO and resumes skip policy at a strictly future target', async () => {
  const sessionId = SessionId('pause-owner')
  const test = await setup()
  const record = await test.service.create(sessionId, {
    prompt: 'Manage me', title: 'Manage me', every_seconds: 300,
  })
  const initial = (await test.service.taskCatalog())[0]!
  expect(await test.service.pause({ sessionId, id: record.id, expected: initial }))
    .toEqual({ id: record.id, updated: true, paused: true, record })
  expect(table(test).get(record.id)?.paused).toBe(true)
  vi.setSystemTime(new Date('2026-11-18T08:30:00.000Z'))
  await table(test).put(record.id, { ...table(test).get(record.id)!, missedRunPolicy: 'skip' })
  const paused = (await test.service.taskCatalog())[0]!
  expect(await test.service.resume({ sessionId, id: record.id, expected: paused }))
    .toEqual({
      id: record.id, updated: true, paused: false,
      record: { ...record, scheduledAt: '2026-11-18T08:35:00.000Z' },
    })
  expect(table(test).get(record.id)).toMatchObject({
    paused: false, record: { scheduledAt: '2026-11-18T08:35:00.000Z' },
  })
  expect(test.resolve).not.toHaveBeenCalled()
})

it('returns the existing conflict family for stale pause and resume requests', async () => {
  const sessionId = SessionId('conflict-owner')
  const test = await setup()
  const record = await test.service.create(sessionId, {
    prompt: 'Manage me', title: 'Manage me', every_seconds: 300,
  })
  const stale = { ...(await test.service.taskCatalog())[0]!, scheduledAt: '2026-11-18T09:00:00.000Z' }
  expect(await test.service.pause({ sessionId, id: record.id, expected: stale }))
    .toEqual({ id: record.id, updated: false, code: 'schedule_conflict' })
  expect(await test.service.resume({ sessionId, id: record.id, expected: stale }))
    .toEqual({ id: record.id, updated: false, code: 'schedule_conflict' })
})
