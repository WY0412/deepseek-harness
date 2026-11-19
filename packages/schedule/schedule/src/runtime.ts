/** Host timer over stored tasks; Session activation is a delivery operation. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'schedule': { kind: 'schedule' } & ContextFormed
  }
}
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { isRecurringScheduleRecord, renderReminderFraming, renderRecurringReminderBatchFraming, resolveRecurringOccurrence } from './domain.ts'
import type { DeliveryRetentionBounds, RecurringScheduleRecord } from './types.ts'
import type { ScheduleExecutionSummary } from './types.ts'
import { resolveScheduleTaskCompat, type ScheduleTask } from './storage.ts'
import { appendDelivery } from './delivery-history.ts'
import type { ScheduleActionRegistry } from './action-registry.ts'
import type { MessageDestinationService } from '@deepseek-ai/dsh-message-destination'

/** Largest delay Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Owns at most one timer across recomputations; delivery and management share the serialized operation. */
export class ScheduleRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopping = false
  private requested = false
  private readonly startupCutoff = Date.now()
  private startupCalibrated = false
  private readonly actionControllers = new Map<string, AbortController>()
  private readonly actionPromises = new Set<Promise<void>>()

  /**
   * @param ctx - Host services used to resume and enqueue.
   * @param tasks - Current durable tasks.
   * @param transact - Serialize delivery against management writes.
   * @param commit - Persist task status, target, receipt, and history together after durable inbox delivery.
   */
  constructor(
    private readonly ctx: Context,
    private readonly tasks: () => readonly ScheduleTask[],
    private readonly transact: (work: () => Promise<void>) => Promise<void>,
    private readonly commit: (task: ScheduleTask) => Promise<void>,
    private readonly retention: DeliveryRetentionBounds,
    private readonly executionRetention: DeliveryRetentionBounds,
    private readonly actionRegistry: () => ScheduleActionRegistry | undefined = () => undefined,
    private readonly destinations: () => MessageDestinationService | undefined = () => undefined,
  ) {}

  /**
   * Recompute the nearest obligation after startup or a durable change.
   * Dispatch failures are logged; refused admission does not retry automatically.
   */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.running !== undefined) return
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.transact(async () => { await this.drive() })
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup runs.
      this.requested = false
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
    }).finally(() => {
      this.running = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** Stop the timer and drain an accepted delivery before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.clearTimer()
    for (const controller of this.actionControllers.values()) controller.abort()
    // requestDrive reports execution failures; teardown only waits for quiescence.
    await this.running?.catch(() => undefined)
    await Promise.allSettled([...this.actionPromises])
  }

  /** Cancel a currently running action after its owning delete has been admitted. */
  cancel(taskId: string): void {
    this.actionControllers.get(taskId)?.abort()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drive(): Promise<void> {
    this.clearTimer()
    const failed = new Set<string>()
    const handled = new Set<string>()
    const scanNow = Date.now()
    let tasks = this.tasks()
    if (!this.startupCalibrated) {
      this.startupCalibrated = true
      for (const task of tasks) {
        if (task.status !== 'active' || task.actionRun === undefined) continue
        const execution = resolveScheduleTaskCompat(task).execution
        if (execution.kind !== 'action') continue
        if (task.actionRun.phase === 'delivering') {
          const summary: ScheduleExecutionSummary = {
            occurrenceAt: task.actionRun.occurrenceAt,
            startedAt: task.actionRun.startedAt,
            finishedAt: task.actionRun.finishedAt,
            outcome: task.actionRun.outcome,
            code: task.actionRun.code,
            summary: task.actionRun.summary,
            delivery: 'unknown',
            ...(task.actionRun.destinationLabel === undefined
              ? {} : { destinationLabel: task.actionRun.destinationLabel }),
          }
          await this.commit(this.completedActionTask(task, summary, this.startupCutoff))
        } else if (task.actionRun.attempts >= 2) {
          const finishedAt = new Date(this.startupCutoff).toISOString()
          const summary: ScheduleExecutionSummary = {
            occurrenceAt: task.actionRun.occurrenceAt, startedAt: task.actionRun.startedAt, finishedAt,
            outcome: 'failed', code: 'action_interrupted', summary: 'Action execution was interrupted twice.',
            delivery: 'not_requested', destinationLabel: execution.destination.label,
          }
          await this.commit(this.completedActionTask(task, summary, this.startupCutoff))
        } else if (this.actionRegistry()?.get(execution.provider) !== undefined) {
          await this.retryAction(task)
        }
      }
      tasks = this.tasks()
      for (const task of tasks) {
        const compat = resolveScheduleTaskCompat(task)
        if (task.status !== 'active' || compat.paused || compat.missedRunPolicy !== 'skip'
          || task.actionRun !== undefined
          || !isRecurringScheduleRecord(task.record)
          || Date.parse(task.record.scheduledAt) > this.startupCutoff) continue
        if (compat.execution.kind === 'action'
          && this.actionRegistry()?.get(compat.execution.provider) === undefined) continue
        const occurrence = resolveRecurringOccurrence(task.record, this.startupCutoff)
        await this.commit({
          ...task,
          record: { ...task.record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt },
          status: occurrence.nextScheduledAt === undefined ? 'inactive' : 'active',
        })
      }
      tasks = this.tasks()
    }
    for (const task of tasks) {
      if (task.status !== 'active') continue
      const compat = resolveScheduleTaskCompat(task)
      if (compat.paused) {
        this.ctx.logger.warn(`schedule: task ${JSON.stringify(task.record.id)} is frozen while paused`)
      } else if (compat.execution.kind === 'action') {
        const actions = this.actionRegistry()
        if (actions?.get(compat.execution.provider) === undefined) {
          this.ctx.logger.warn(
            `schedule: task ${JSON.stringify(task.record.id)} is frozen because action provider ${JSON.stringify(compat.execution.provider)} is unavailable`,
          )
        }
      }
    }
    const runnable = tasks.filter((task) => {
      const compat = resolveScheduleTaskCompat(task)
      return task.status === 'active' && !compat.paused && compat.execution.kind === 'prompt'
    })
    const due = runnable.filter(task => Date.parse(task.record.scheduledAt) <= scanNow)
    for (const task of due) {
      if (this.stopping) return
      if (handled.has(task.record.id)) continue
      const group = isRecurringScheduleRecord(task.record)
        ? due.filter(candidate => candidate.sessionId === task.sessionId && isRecurringScheduleRecord(candidate.record))
        : [task]
      for (const member of group) handled.add(member.record.id)
      let admitted = group
      const committed = new Set<ScheduleTask['record']['id']>()
      try {
        const resolved = await this.ctx.sessionController.resolveAgent(task.sessionId)
        if ('error' in resolved) throw resolved.error
        if (this.stopping) return
        const now = Date.now()
        // Session restoration can span a wall-clock rollback; future members keep their timer obligation.
        admitted = group.filter(member => Date.parse(member.record.scheduledAt) <= now)
        if (admitted.length === 0) continue
        const recurring = admitted.filter((member): member is ScheduleTask & { record: RecurringScheduleRecord } =>
          isRecurringScheduleRecord(member.record))
        const occurrences = recurring.map(member => ({
          task: member, occurrence: resolveRecurringOccurrence(member.record, now),
        }))
        const text = isRecurringScheduleRecord(task.record)
          ? renderRecurringReminderBatchFraming(occurrences.map(({ task: member, occurrence }) => ({
            record: member.record, occurrenceAt: occurrence.occurrenceAt,
          })))
          : renderReminderFraming(task.record)
        const message = createUserMessage({
          content: [{ type: 'text', text }], source: { kind: 'schedule' },
        })
        // followup synchronously appends the inbox splice before flush observes the Session.
        resolved.agent.followup(message)
        const flushed = await this.ctx.sessions.flush(resolved.agent.session)
        if (!flushed) throw new Error('Session persistence did not acknowledge the reminder')
        const deliveredAt = new Date(Date.now()).toISOString()
        if (!isRecurringScheduleRecord(task.record)) {
          await this.commit({
            ...task, status: 'inactive',
            ...appendDelivery(task, { scheduledAt: task.record.scheduledAt, deliveredAt, messageId: message.id }, this.retention),
          })
          committed.add(task.record.id)
        }
        for (const { task: member, occurrence } of occurrences) {
          await this.commit({
            ...member,
            record: { ...member.record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt },
            status: occurrence.nextScheduledAt === undefined ? 'inactive' : 'active',
            ...appendDelivery(member, { scheduledAt: occurrence.occurrenceAt, deliveredAt, messageId: message.id }, this.retention),
          })
          committed.add(member.record.id)
        }
      } catch (error: unknown) {
        // Successful commits and targets made future by clock rollback keep their timer obligation.
        const pending = admitted.filter(member => !committed.has(member.record.id))
        const failedAt = Date.now()
        for (const member of pending) {
          if (Date.parse(member.record.scheduledAt) <= failedAt) failed.add(member.record.id)
        }
        const ids = pending.map(member => member.record.id)
        this.ctx.logger.warn(`schedule: reminders ${JSON.stringify(ids)} were not acknowledged: ${String(error)}`)
      }
    }
    const actions = this.actionRegistry()
    if (actions !== undefined) {
      const actionDue = this.tasks().filter((task) => {
        const compat = resolveScheduleTaskCompat(task)
        return task.status === 'active' && !compat.paused && compat.execution.kind === 'action'
          && task.actionRun === undefined && !this.actionControllers.has(task.record.id)
          && actions.get(compat.execution.provider) !== undefined
          && Date.parse(task.record.scheduledAt) <= scanNow
      })
      for (const task of actionDue) await this.admitAction(task, scanNow)
    }
    if (this.stopping) return
    const next = this.tasks().filter((task) => {
      const compat = resolveScheduleTaskCompat(task)
      return task.status === 'active' && !compat.paused && task.actionRun === undefined
        && (compat.execution.kind === 'prompt'
          ? !failed.has(task.record.id)
          : actions?.get(compat.execution.provider) !== undefined)
    })
      .reduce<number | undefined>((at, task) => {
        const target = Date.parse(task.record.scheduledAt)
        return at === undefined ? target : Math.min(at, target)
      }, undefined)
    if (next !== undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() },
        Math.max(0, Math.min(next - Date.now(), MAX_TIMER_DELAY_MS)))
      this.timer.unref()
    }
  }

  private async admitAction(task: ScheduleTask, now: number): Promise<void> {
    const compat = resolveScheduleTaskCompat(task)
    if (compat.execution.kind !== 'action') return
    const occurrenceAt = isRecurringScheduleRecord(task.record)
      ? resolveRecurringOccurrence(task.record, now).occurrenceAt
      : task.record.scheduledAt
    const startedAt = new Date(Date.now()).toISOString()
    const controller = new AbortController()
    await this.commit({ ...task, actionRun: { phase: 'running', occurrenceAt, startedAt, attempts: 1 } })
    this.actionControllers.set(task.record.id, controller)
    const promise = this.executeAction(task.record.id, occurrenceAt, startedAt, controller.signal)
      .catch((error: unknown) => {
        this.ctx.logger.warn(`schedule: action ${JSON.stringify(task.record.id)} completion failed: ${String(error)}`)
      })
      .finally(() => {
        this.actionControllers.delete(task.record.id)
        this.actionPromises.delete(promise)
        if (!this.stopping) this.requestDrive()
      })
    this.actionPromises.add(promise)
  }

  private async retryAction(task: ScheduleTask): Promise<void> {
    if (task.actionRun?.phase !== 'running') return
    const controller = new AbortController()
    const run = { ...task.actionRun, attempts: 2 as const }
    await this.commit({ ...task, actionRun: run })
    this.actionControllers.set(task.record.id, controller)
    const promise = this.executeAction(task.record.id, run.occurrenceAt, run.startedAt, controller.signal)
      .catch((error: unknown) => {
        this.ctx.logger.warn(`schedule: retried action ${JSON.stringify(task.record.id)} completion failed: ${String(error)}`)
      })
      .finally(() => {
        this.actionControllers.delete(task.record.id)
        this.actionPromises.delete(promise)
        if (!this.stopping) this.requestDrive()
      })
    this.actionPromises.add(promise)
  }

  private async executeAction(
    taskId: ScheduleTask['record']['id'],
    occurrenceAt: string,
    startedAt: string,
    signal: AbortSignal,
  ): Promise<void> {
    const admitted = this.tasks().find(task => task.record.id === taskId)
    if (admitted === undefined) return
    const execution = resolveScheduleTaskCompat(admitted).execution
    if (execution.kind !== 'action') return
    let summary: ScheduleExecutionSummary
    try {
      const registry = this.actionRegistry()
      if (registry === undefined) throw new Error('schedule action registry is unavailable')
      const result = await registry.execute(execution.provider, {
        taskId, occurrenceAt, config: execution.config, signal,
      })
      const finishedAt = new Date(Date.now()).toISOString()
      let delivery: ScheduleExecutionSummary['delivery'] = 'not_requested'
      if (result.notify) {
        await this.transact(async () => {
          const current = this.tasks().find(task => task.record.id === taskId)
          if (current === undefined || current.actionRun?.occurrenceAt !== occurrenceAt) return
          await this.commit({
            ...current,
            actionRun: {
              phase: 'delivering', occurrenceAt, startedAt, finishedAt,
              outcome: result.outcome, code: result.code, summary: result.summary,
              destinationLabel: execution.destination.label,
            },
          })
        })
        signal.throwIfAborted()
        const service = this.destinations()
        if (service === undefined) {
          delivery = 'failed'
        } else {
          try {
            const message = result.message
            if (message === undefined) throw new Error('notifiable action result has no message')
            const sent = await service.send(execution.destination, message, signal)
            delivery = sent.sent ? 'sent' : sent.code === 'delivery_unknown' ? 'unknown' : 'failed'
          } catch (error: unknown) {
            if (signal.aborted) throw error
            delivery = 'failed'
          }
        }
      }
      summary = {
        occurrenceAt, startedAt, finishedAt, outcome: result.outcome, code: result.code,
        summary: result.summary, delivery,
        destinationLabel: execution.destination.label,
      }
    } catch (error: unknown) {
      if (signal.aborted) return
      const finishedAt = new Date(Date.now()).toISOString()
      summary = {
        occurrenceAt, startedAt, finishedAt, outcome: 'failed', code: 'action_failed',
        summary: String(error).slice(0, 500), delivery: 'not_requested',
        destinationLabel: execution.destination.label,
      }
    }
    await this.transact(async () => {
      const current = this.tasks().find(task => task.record.id === taskId)
      if (current === undefined || current.actionRun?.occurrenceAt !== occurrenceAt) return
      await this.commit(this.completedActionTask(current, summary, Date.now()))
    })
  }

  private completedActionTask(task: ScheduleTask, summary: ScheduleExecutionSummary, now: number): ScheduleTask {
    const cutoff = Date.parse(summary.finishedAt) - this.executionRetention.days * 24 * 60 * 60 * 1000
    const history = [...(task.executionHistory ?? [])]
      .filter(item => Date.parse(item.finishedAt) >= cutoff)
    history.push(summary)
    let record = task.record
    let status: ScheduleTask['status'] = 'inactive'
    if (isRecurringScheduleRecord(record)) {
      const occurrence = resolveRecurringOccurrence(record, now)
      record = { ...record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt }
      status = occurrence.nextScheduledAt === undefined ? 'inactive' : 'active'
    }
    const { actionRun: _actionRun, ...withoutRun } = task
    return {
      ...withoutRun, record, status, lastExecution: summary,
      executionHistory: history.slice(-this.executionRetention.records),
    }
  }
}
