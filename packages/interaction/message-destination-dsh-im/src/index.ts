/**
 * DSH-IM adapter for the opaque message-destination capability.
 * @module @deepseek-ai/dsh-message-destination-dsh-im
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {
  DestinationPage,
  DestinationProvider,
  DestinationSendResult,
  DestinationView,
} from '@deepseek-ai/dsh-message-destination'

const PROVIDER_ID = 'dsh-im'
const HASH_PREFIX = 'dsh-im:v1:'

/** Public bot metadata returned by DSH-IM. */
export interface DshImBot {
  readonly botId: string
  readonly channel: string
}

/** Target metadata returned by DSH-IM; route never crosses this adapter. */
export interface DshImTarget {
  readonly targetId: string
  readonly name?: string
  readonly kind: string
  readonly route: Readonly<Record<string, unknown>>
}

/** Structural subset of the same-Host DSH-IM service used by this adapter. */
export interface DshImService {
  listBots(): Promise<readonly DshImBot[]>
  listTargets(botId: string): Promise<readonly DshImTarget[]>
  send(
    botId: string,
    targetId: string,
    text: string,
    options?: { readonly signal?: AbortSignal; readonly format?: 'plain' | 'markdown' },
  ): Promise<{ readonly sent: true }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshIm: DshImService
  }
}

/** Adapter configuration. */
export interface Config {
  /** Maximum time to await an upstream send whose outcome may become unknown. */
  readonly timeoutMs?: number
}

interface ResolvedDestination {
  readonly botId: string
  readonly targetId: string
  readonly view: DestinationView
}

function destinationId(botId: string, targetId: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(botId).update('\0').update(targetId).digest('hex')}`
}

function publicView(bot: DshImBot, target: DshImTarget): DestinationView {
  return Object.freeze({
    ref: Object.freeze({
      provider: PROVIDER_ID,
      id: destinationId(bot.botId, target.targetId),
      label: target.name?.trim() || `${bot.channel} ${target.kind}`,
      kind: target.kind,
    }),
    channel: bot.channel,
  })
}

function upstreamCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function mappedFailure(error: unknown, outerSignal: AbortSignal, timedOut: boolean): DestinationSendResult {
  if (timedOut) return { sent: false, code: 'delivery_unknown' }
  if (outerSignal.aborted || upstreamCode(error) === 'cancelled') return { sent: false, code: 'cancelled' }
  switch (upstreamCode(error)) {
    case 'bot-not-connected': return { sent: false, code: 'destination_offline' }
    case 'unknown-bot':
    case 'unknown-target': return { sent: false, code: 'destination_unavailable' }
    case 'target-rejected': return { sent: false, code: 'destination_rejected' }
    default: return { sent: false, code: 'delivery_failed' }
  }
}

class DshImProvider implements DestinationProvider {
  readonly id = PROVIDER_ID

  constructor(private readonly im: DshImService, private readonly timeoutMs: number) {}

  async listPage(cursor: string | undefined, signal: AbortSignal): Promise<DestinationPage> {
    if (cursor !== undefined) return { items: [] }
    return { items: (await this.enumerate(signal)).map(entry => entry.view) }
  }

  async resolve(id: string, signal: AbortSignal): Promise<DestinationView | undefined> {
    return (await this.resolveInternal(id, signal))?.view
  }

  async send(id: string, text: string, signal: AbortSignal): Promise<DestinationSendResult> {
    const destination = await this.resolveInternal(id, signal)
    if (destination === undefined) return { sent: false, code: 'destination_unavailable' }

    const timeout = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      timeout.abort(new Error('DSH-IM delivery timeout'))
    }, this.timeoutMs)
    const combined = AbortSignal.any([signal, timeout.signal])
    try {
      const result = await Promise.race([
        this.im.send(destination.botId, destination.targetId, text, { signal: combined }),
        new Promise<never>((_resolve, reject) => {
          combined.addEventListener('abort', () => reject(combined.reason), { once: true })
        }),
      ])
      return result.sent === true ? { sent: true } : { sent: false, code: 'delivery_failed' }
    } catch (error) {
      return mappedFailure(error, signal, timedOut)
    } finally {
      clearTimeout(timer)
    }
  }

  private async resolveInternal(id: string, signal: AbortSignal): Promise<ResolvedDestination | undefined> {
    if (!id.startsWith(HASH_PREFIX)) return undefined
    return (await this.enumerate(signal)).find(entry => entry.view.ref.id === id)
  }

  private async enumerate(signal: AbortSignal): Promise<ResolvedDestination[]> {
    if (signal.aborted) throw signal.reason
    const bots = await this.im.listBots()
    const result: ResolvedDestination[] = []
    for (const bot of bots) {
      if (signal.aborted) throw signal.reason
      const targets = await this.im.listTargets(bot.botId)
      for (const target of targets) {
        result.push({ botId: bot.botId, targetId: target.targetId, view: publicView(bot, target) })
      }
    }
    return result.sort((left, right) => left.view.ref.id.localeCompare(right.view.ref.id))
  }
}

export const name = 'message-destination-dsh-im'
export const inject = ['messageDestinations', 'dshIm']

/** Register the DSH-IM provider into the destination service. */
export function apply(ctx: Context, config: Config = {}): void {
  const timeoutMs = config.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive safe integer')
  ctx.effect(() => ctx.messageDestinations.register(new DshImProvider(ctx.dshIm, timeoutMs)))
}

export default Object.assign(apply, { inject })
