/** Durable Host-wide Schedule tasks, independently of Session activation. */
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { decodeScheduleRecord } from './domain.ts'
import type {
  ScheduleActionRun, ScheduleExecution, ScheduleExecutionSummary, ScheduleId, ScheduleJsonValue, ScheduleRecord,
} from './types.ts'

const recordSchema = z.unknown().transform((value, context): ScheduleRecord => {
  try {
    return decodeScheduleRecord(value)
  } catch (error: unknown) {
    context.addIssue({ code: 'custom', message: String(error) })
  }
  return z.NEVER
})

const instantSchema = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
  message: 'Expected a canonical four-digit-year UTC calendar instant',
})

const deliveryReceiptSchema = z.object({
  scheduledAt: instantSchema,
  deliveredAt: instantSchema,
  messageId: z.string().min(1).refine(value => value.trim() === value).transform(MessageId),
}).strict()

const deliveryHistorySchema = z.object({
  records: z.array(deliveryReceiptSchema.extend({ prompt: z.string().optional() }).strict()),
  earlierRecordsUnavailable: z.boolean(),
  earlierRecordsPruned: z.boolean().optional(),
}).strict().refine(history => new Set(history.records.map(record => record.messageId)).size === history.records.length, {
  message: 'Delivery history message identities must be unique within a task',
})

const nonEmptyTrimmedString = z.string().min(1).refine(value => value.trim() === value)
const jsonValueSchema: z.ZodType<ScheduleJsonValue> = z.json()
const destinationRefSchema = z.object({
  provider: nonEmptyTrimmedString,
  id: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  kind: nonEmptyTrimmedString,
}).strict()
const executionSchema: z.ZodType<ScheduleExecution> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), prompt: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal('action'),
    provider: nonEmptyTrimmedString,
    config: jsonValueSchema,
    destination: destinationRefSchema,
  }).strict(),
])
const executionSummarySchema: z.ZodType<ScheduleExecutionSummary> = z.object({
  occurrenceAt: instantSchema,
  startedAt: instantSchema,
  finishedAt: instantSchema,
  outcome: z.enum(['succeeded', 'failed']),
  code: nonEmptyTrimmedString,
  summary: z.string().max(500),
  delivery: z.enum(['not_requested', 'sent', 'failed', 'unknown']),
  destinationLabel: z.string().min(1).max(500).optional(),
}).strict()
const actionRunSchema: z.ZodType<ScheduleActionRun> = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('running'), occurrenceAt: instantSchema, startedAt: instantSchema,
    attempts: z.number().int().min(1).max(2),
  }).strict(),
  z.object({
    phase: z.literal('delivering'), occurrenceAt: instantSchema, startedAt: instantSchema,
    finishedAt: instantSchema, outcome: z.enum(['succeeded', 'failed']), code: nonEmptyTrimmedString,
    summary: z.string().max(500), destinationLabel: z.string().min(1).max(500).optional(),
  }).strict(),
])

/** Stored task binds one schedule to its original Session; absent status decodes as active. */
export const scheduleTaskSchema = z.object({
  sessionId: z.string().min(1).transform(SessionId),
  record: recordSchema,
  status: z.enum(['active', 'inactive']).default('active'),
  missedRunPolicy: z.enum(['deliver_latest', 'skip']).optional(),
  paused: z.boolean().optional(),
  execution: executionSchema.optional(),
  lastExecution: executionSummarySchema.optional(),
  executionHistory: z.array(executionSummarySchema).max(100).optional(),
  actionRun: actionRunSchema.optional(),
  lastDelivery: deliveryReceiptSchema.optional(),
  deliveryHistory: deliveryHistorySchema.optional(),
}).strict().refine((task) => {
  if (task.deliveryHistory === undefined) return true
  const latest = task.deliveryHistory.records.at(-1)
  if (latest === undefined) return task.lastDelivery === undefined
  return task.lastDelivery !== undefined
    && latest.scheduledAt === task.lastDelivery.scheduledAt
    && latest.deliveredAt === task.lastDelivery.deliveredAt
    && latest.messageId === task.lastDelivery.messageId
}, { message: 'Last delivery must match the latest saved delivery receipt' })

/** Persistent task value; compat fields remain absent until a feature writer supplies them. */
export type ScheduleTask = z.infer<typeof scheduleTaskSchema>

/** Compat defaults consumed without materializing them into an older task row. */
export interface ScheduleTaskCompat {
  readonly missedRunPolicy: 'deliver_latest' | 'skip'
  readonly paused: boolean
  readonly execution: ScheduleExecution
}

/**
 * Resolve optional future fields for runtime decisions without rewriting the task.
 * @param task - Decoded persistent task, possibly written before compat fields existed.
 * @returns Effective policy, pause state, and execution.
 */
export function resolveScheduleTaskCompat(task: ScheduleTask): ScheduleTaskCompat {
  return {
    missedRunPolicy: task.missedRunPolicy ?? 'deliver_latest',
    paused: task.paused ?? false,
    execution: task.execution ?? { kind: 'prompt', prompt: task.record.prompt },
  }
}

/** Authoritative Schedule storage; malformed tasks reject opening the domain. */
export const scheduleDomain = defineDomain({
  name: 'schedule', version: 1,
  tables: { tasks: domainTable<ScheduleId, ScheduleTask>(scheduleTaskSchema) },
})
