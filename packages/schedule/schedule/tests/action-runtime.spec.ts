import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEveryScheduleRecord, ScheduleId } from '../src/domain.ts'
import { scheduleDomain, type ScheduleTask } from '../src/storage.ts'
import type { ScheduleActionRequest, ScheduleRecord } from '../src/types.ts'
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

function table(test: Awaited<ReturnType<typeof harness>>) {
  const domain = test.ctx.storageDomain.get('schedule')
  if (domain === undefined) throw new Error('Schedule domain not initialized')
  return domain.table('tasks') as KvTable<ScheduleRecord['id'], ScheduleTask>
}

it('executes a due typed action without restoring a Session, records its result, and advances recurrence', async () => {
  const taskId = ScheduleId('action-task')
  const sessionId = SessionId('action-owner')
  const execute = vi.fn(async () => ({
    outcome: 'succeeded' as const, code: 'unchanged', summary: 'No cluster changes', notify: false,
  }))
  const record = createEveryScheduleRecord(taskId, 'Action placeholder', 300,
    Date.parse('2026-11-18T07:55:00.000Z'), 'Cluster watch')
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx, facility) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({ cluster: z.string() }).strict(), execute,
      })
      const domain = await facility.open(scheduleDomain)
      await domain.table('tasks').put(taskId, {
        sessionId, record, status: 'active', missedRunPolicy: 'deliver_latest', paused: false,
        execution: {
          kind: 'action', provider: 'cluster-watch', config: { cluster: 'prod' },
          destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' },
        },
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await domain.close()
    } })
  await vi.advanceTimersByTimeAsync(0)
  expect(test.ctx.get('scheduleActions')?.get('cluster-watch')).toBeDefined()
  expect(table(test).get(taskId)?.execution).toMatchObject({ kind: 'action', provider: 'cluster-watch' })
  await vi.waitFor(() => { expect(execute).toHaveBeenCalledTimes(1) })
  await vi.waitFor(() => { expect(table(test).get(taskId)?.lastExecution).toBeDefined() })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({
    taskId, occurrenceAt: '2026-11-18T08:00:00.000Z', config: { cluster: 'prod' }, signal: expect.any(AbortSignal),
  }))
  expect(table(test).get(taskId)).toMatchObject({
    status: 'active', record: { scheduledAt: '2026-11-18T08:05:00.000Z' },
    lastExecution: {
      occurrenceAt: '2026-11-18T08:00:00.000Z', outcome: 'succeeded', code: 'unchanged',
      summary: 'No cluster changes', delivery: 'not_requested', destinationLabel: 'Ops',
    },
    executionHistory: [{ occurrenceAt: '2026-11-18T08:00:00.000Z' }],
  })
  expect(table(test).get(taskId)?.actionRun).toBeUndefined()
  expect(test.resolve).not.toHaveBeenCalled()
})

it('persists delivering before a requested destination send and records the receipt outcome', async () => {
  const taskId = ScheduleId('notify-task')
  const sessionId = SessionId('notify-owner')
  const send = vi.fn(async () => ({ sent: true as const }))
  const record = createEveryScheduleRecord(taskId, 'Action placeholder', 300,
    Date.parse('2026-11-18T07:55:00.000Z'), 'Cluster watch')
  const test = await harness({ actionRegistry: true, messageDestinations: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx, facility) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({}).strict(),
        execute: async () => ({ outcome: 'succeeded', code: 'changed', summary: 'Changed', notify: true, message: 'Alert' }),
      })
      ctx.messageDestinations.register({ id: 'im', listPage: async () => ({ items: [] }), resolve: async () => undefined, send })
      const domain = await facility.open(scheduleDomain)
      await domain.table('tasks').put(taskId, {
        sessionId, record, status: 'active', execution: { kind: 'action', provider: 'cluster-watch', config: {}, destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' } },
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await domain.close()
    } })
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => { expect(table(test).get(taskId)?.lastExecution?.delivery).toBe('sent') })
  expect(send).toHaveBeenCalledWith('opaque', 'Alert', expect.any(AbortSignal))
  expect(test.resolve).not.toHaveBeenCalled()
})

it('retries one persisted running occurrence without applying startup skip first', async () => {
  const taskId = ScheduleId('retry-task')
  const sessionId = SessionId('retry-owner')
  const execute = vi.fn(async () => ({
    outcome: 'succeeded' as const, code: 'recovered', summary: 'Recovered action', notify: false,
  }))
  const record = createEveryScheduleRecord(taskId, 'Action placeholder', 300,
    Date.parse('2026-11-18T07:00:00.000Z'), 'Cluster watch')
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx, facility) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({}).strict(), execute,
      })
      const domain = await facility.open(scheduleDomain)
      await domain.table('tasks').put(taskId, {
        sessionId, record: { ...record, scheduledAt: '2026-11-18T07:05:00.000Z' }, status: 'active',
        missedRunPolicy: 'skip', paused: false,
        execution: {
          kind: 'action', provider: 'cluster-watch', config: {},
          destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' },
        },
        actionRun: {
          phase: 'running', occurrenceAt: '2026-11-18T07:05:00.000Z',
          startedAt: '2026-11-18T07:05:00.000Z', attempts: 1,
        },
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await domain.close()
    } })
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => { expect(table(test).get(taskId)?.lastExecution?.code).toBe('recovered') })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ occurrenceAt: '2026-11-18T07:05:00.000Z' }))
  expect(table(test).get(taskId)?.record.scheduledAt).toBe('2026-11-18T08:05:00.000Z')
})

it('converts a persisted delivering occurrence to unknown without resending', async () => {
  const taskId = ScheduleId('unknown-task')
  const sessionId = SessionId('unknown-owner')
  const execute = vi.fn(async () => ({
    outcome: 'succeeded' as const, code: 'unexpected', summary: 'Unexpected', notify: false,
  }))
  const record = createEveryScheduleRecord(taskId, 'Action placeholder', 300,
    Date.parse('2026-11-18T07:00:00.000Z'), 'Cluster watch')
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx, facility) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({}).strict(), execute,
      })
      const domain = await facility.open(scheduleDomain)
      await domain.table('tasks').put(taskId, {
        sessionId, record: { ...record, scheduledAt: '2026-11-18T07:05:00.000Z' }, status: 'active',
        missedRunPolicy: 'skip', paused: false,
        execution: {
          kind: 'action', provider: 'cluster-watch', config: {},
          destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' },
        },
        actionRun: {
          phase: 'delivering', occurrenceAt: '2026-11-18T07:05:00.000Z',
          startedAt: '2026-11-18T07:05:00.000Z', finishedAt: '2026-11-18T07:05:10.000Z',
          outcome: 'succeeded', code: 'changed', summary: 'Changes detected', destinationLabel: 'Ops',
        },
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await domain.close()
    } })
  await vi.advanceTimersByTimeAsync(0)
  expect(execute).not.toHaveBeenCalled()
  expect(table(test).get(taskId)?.lastExecution).toMatchObject({
    occurrenceAt: '2026-11-18T07:05:00.000Z', code: 'changed', delivery: 'unknown',
  })
  expect(table(test).get(taskId)?.record.scheduledAt).toBe('2026-11-18T08:05:00.000Z')
})

it('aborts a running provider when deletion commits and discards its late result', async () => {
  const taskId = ScheduleId('delete-running')
  const sessionId = SessionId('delete-owner')
  const started = Promise.withResolvers<AbortSignal>()
  const execute = vi.fn(async ({ signal }: ScheduleActionRequest) => {
    started.resolve(signal)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    return { outcome: 'succeeded' as const, code: 'late', summary: 'Late result', notify: false }
  })
  const record = createEveryScheduleRecord(taskId, 'Action placeholder', 300,
    Date.parse('2026-11-18T07:55:00.000Z'), 'Cluster watch')
  const test = await harness({ actionRegistry: true, onContext: ctx => contexts.push(ctx),
    beforeService: async (ctx, facility) => {
      ctx.scheduleActions.register({
        id: 'cluster-watch', title: 'Cluster watch', config: z.object({}).strict(), execute,
      })
      const domain = await facility.open(scheduleDomain)
      await domain.table('tasks').put(taskId, {
        sessionId, record, status: 'active', execution: {
          kind: 'action', provider: 'cluster-watch', config: {},
          destination: { provider: 'im', id: 'opaque', label: 'Ops', kind: 'wechat' },
        },
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await domain.close()
    } })
  await vi.advanceTimersByTimeAsync(0)
  const signal = await started.promise
  expect(await test.service.delete({ sessionId, id: taskId })).toEqual({ id: taskId, deleted: true })
  expect(signal.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(table(test).get(taskId)).toBeUndefined()
})
