/**
 * Opaque message-destination capability seam shared by automation consumers.
 * @module @deepseek-ai/dsh-message-destination
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Maximum number of destinations exposed by one list operation. */
export const DESTINATION_LIMIT = 200

/** Persistable, provider-owned destination reference. */
export interface DestinationRef {
  readonly provider: string
  readonly id: string
  readonly label: string
  readonly kind: string
}

/** Public destination metadata safe for Schedule APIs and selectors. */
export interface DestinationView {
  readonly ref: DestinationRef
  readonly channel: string
  readonly avatarUrl?: string
}

/** Successful or classified unsuccessful delivery result. */
export type DestinationSendResult =
  | { readonly sent: true; readonly receipt?: string }
  | { readonly sent: false; readonly code: string }

/** One page returned by a destination provider. */
export interface DestinationPage {
  readonly items: readonly DestinationView[]
  readonly nextCursor?: string
}

/** Provider contract; raw channel identifiers stay behind this boundary. */
export interface DestinationProvider {
  readonly id: string
  listPage(cursor: string | undefined, signal: AbortSignal): Promise<DestinationPage>
  resolve(id: string, signal: AbortSignal): Promise<DestinationView | undefined>
  send(id: string, text: string, signal: AbortSignal): Promise<DestinationSendResult>
}

/** Stable error taxonomy for destination directory failures. */
export class DestinationError extends Error {
  constructor(message: string, public readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DestinationError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageDestinations: MessageDestinationService
  }
}

function cancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new DestinationError('Message destination operation was cancelled.', 'cancelled', {
    cause: signal.reason,
  })
}

function validateProviderId(id: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id)) {
    throw new DestinationError('Destination provider id is invalid.', 'invalid_provider')
  }
}

/** Registry and consumer API for opaque message destinations. */
export class MessageDestinationService extends Service {
  private readonly providers = new Map<string, DestinationProvider>()

  constructor(ctx: Context) {
    super(ctx, 'messageDestinations')
  }

  /** Register one provider until the returned disposer is called. */
  register(provider: DestinationProvider): () => void {
    validateProviderId(provider.id)
    if (this.providers.has(provider.id)) {
      throw new DestinationError(`Destination provider "${provider.id}" is already registered.`, 'provider_conflict')
    }
    this.providers.set(provider.id, provider)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /** Enumerate all provider pages, failing closed above the public limit. */
  async list(signal: AbortSignal): Promise<readonly DestinationView[]> {
    cancelled(signal)
    const result: DestinationView[] = []
    for (const provider of this.providers.values()) {
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        cancelled(signal)
        const page = await provider.listPage(cursor, signal)
        result.push(...page.items)
        if (result.length > DESTINATION_LIMIT) {
          throw new DestinationError(
            `Message destination directory exceeds the ${DESTINATION_LIMIT}-entry limit.`,
            'destination_limit_exceeded',
          )
        }
        cursor = page.nextCursor
        if (cursor !== undefined && seen.has(cursor)) {
          throw new DestinationError('Destination provider repeated a pagination cursor.', 'invalid_provider_response')
        }
        if (cursor !== undefined) seen.add(cursor)
      } while (cursor !== undefined)
    }
    return Object.freeze(result.slice())
  }

  /** Resolve a saved ref using current provider authorization and metadata. */
  async resolve(ref: DestinationRef, signal: AbortSignal): Promise<DestinationView | undefined> {
    cancelled(signal)
    return this.provider(ref.provider).resolve(ref.id, signal)
  }

  /** Send through the exact provider and opaque id stored in the ref. */
  async send(ref: DestinationRef, text: string, signal: AbortSignal): Promise<DestinationSendResult> {
    cancelled(signal)
    return this.provider(ref.provider).send(ref.id, text, signal)
  }

  private provider(id: string): DestinationProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) {
      throw new DestinationError('Message destination provider is unavailable.', 'provider_unavailable')
    }
    return provider
  }
}

export default MessageDestinationService
