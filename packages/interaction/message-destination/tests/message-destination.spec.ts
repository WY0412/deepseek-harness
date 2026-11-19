import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import MessageDestinationService, {
  DestinationError,
  type DestinationProvider,
  type DestinationView,
} from '@deepseek-ai/dsh-message-destination'

const signal = (): AbortSignal => new AbortController().signal
const view = (id: string): DestinationView => ({
  ref: { provider: 'fixture', id, label: `Destination ${id}`, kind: 'group' },
  channel: 'fixture-channel',
})

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MessageDestinationService)
  return ctx
}

describe('MessageDestinationService', () => {
  it('rejects duplicate provider ids and removes registrations with their owner', async () => {
    const ctx = await mounted()
    const provider: DestinationProvider = {
      id: 'fixture',
      listPage: async () => ({ items: [] }),
      resolve: async () => undefined,
      send: async () => ({ sent: false, code: 'unavailable' }),
    }
    const dispose = ctx.messageDestinations.register(provider)

    expect(() => ctx.messageDestinations.register(provider)).toThrow(/already registered/)
    dispose()
    await expect(ctx.messageDestinations.resolve(view('a').ref, signal())).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('collects provider pages in order and forwards the exact cancellation signal', async () => {
    const ctx = await mounted()
    const received: AbortSignal[] = []
    ctx.messageDestinations.register({
      id: 'fixture',
      async listPage(cursor, currentSignal) {
        received.push(currentSignal)
        return cursor === undefined
          ? { items: [view('a')], nextCursor: 'next' }
          : { items: [view('b')] }
      },
      resolve: async () => undefined,
      send: async () => ({ sent: false, code: 'unavailable' }),
    })
    const currentSignal = signal()

    await expect(ctx.messageDestinations.list(currentSignal)).resolves.toEqual([view('a'), view('b')])
    expect(received).toEqual([currentSignal, currentSignal])
  })

  it('rejects a provider directory above 200 entries with a structured error', async () => {
    const ctx = await mounted()
    ctx.messageDestinations.register({
      id: 'fixture',
      listPage: async () => ({ items: Array.from({ length: 201 }, (_, index) => view(String(index))) }),
      resolve: async () => undefined,
      send: async () => ({ sent: false, code: 'unavailable' }),
    })

    await expect(ctx.messageDestinations.list(signal())).rejects.toEqual(expect.objectContaining<Partial<DestinationError>>({
      name: 'DestinationError',
      code: 'destination_limit_exceeded',
    }))
  })

  it('routes resolve and send by provider without trusting the saved label', async () => {
    const ctx = await mounted()
    const resolve = vi.fn(async (id: string) => id === 'real' ? view('real') : undefined)
    const send = vi.fn(async () => ({ sent: true as const }))
    ctx.messageDestinations.register({ id: 'fixture', listPage: async () => ({ items: [] }), resolve, send })
    const forgedLabel = { provider: 'fixture', id: 'real', label: 'forged', kind: 'direct' }
    const currentSignal = signal()

    await expect(ctx.messageDestinations.resolve(forgedLabel, currentSignal)).resolves.toEqual(view('real'))
    await expect(ctx.messageDestinations.send(forgedLabel, 'hello', currentSignal)).resolves.toEqual({ sent: true })
    expect(resolve).toHaveBeenCalledWith('real', currentSignal)
    expect(send).toHaveBeenCalledWith('real', 'hello', currentSignal)
  })
})
