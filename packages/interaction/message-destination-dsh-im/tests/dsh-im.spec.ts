import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import MessageDestinationService from '@deepseek-ai/dsh-message-destination'
import { describe, expect, it, vi } from 'vitest'
import DshImDestinationProvider, { type DshImService } from '@deepseek-ai/dsh-message-destination-dsh-im'

const abortSignal = (): AbortSignal => new AbortController().signal
const hash = (botId: string, targetId: string): string => `dsh-im:v1:${createHash('sha256').update(botId).update('\0').update(targetId).digest('hex')}`

function fakeIm(overrides: Partial<DshImService> = {}): DshImService {
  return {
    listBots: vi.fn(async () => [
      { botId: 'bot-private-a', channel: 'wechat' },
      { botId: 'bot-private-b', channel: 'slack' },
    ]),
    listTargets: vi.fn(async botId => botId.endsWith('a')
      ? [{ targetId: 'target-private-a', name: '值班群', kind: 'group', route: { secret: 'route-a' } }]
      : [{ targetId: 'target-private-b', name: '发布群', kind: 'channel', route: { secret: 'route-b' } }]),
    send: vi.fn(async () => ({ sent: true as const })),
    ...overrides,
  }
}

async function mounted(im: DshImService, timeoutMs = 5_000, loadAdapter?: (ctx: Context) => boolean): Promise<Context> {
  const ctx = new Context()
  class FakeDshIm extends Service implements DshImService {
    constructor(inner: Context) { super(inner, 'dshIm') }
    listBots = im.listBots
    listTargets = im.listTargets
    send = im.send
  }
  await ctx.plugin(MessageDestinationService)
  if (loadAdapter === undefined) {
    await ctx.plugin(FakeDshIm)
    await ctx.plugin(DshImDestinationProvider, { timeoutMs })
  } else {
    if (loadAdapter(ctx)) ctx.plugin(DshImDestinationProvider, { timeoutMs })
    await ctx.plugin(FakeDshIm)
  }
  return ctx
}

describe('DSH-IM destination adapter', () => {
  it('lists WeChat targets when the web profile installs DSH-IM after the adapter', async () => {
    const patch = readFileSync(new URL('../../../bundle/web-app/cordis.patch.yml', import.meta.url), 'utf8')
    const expression = /id: message-destination-dsh-im\s+name: [^\n]+\s+disabled: !!js ([^\n]+)/u.exec(patch)?.[1]
    if (expression === undefined) throw new Error('destination adapter entry missing')
    const condition = expression.startsWith('"') ? JSON.parse(expression) : expression
    const shouldDisable = new Function('ctx', 'process', `return (${condition})`)
    const ctx = await mounted(fakeIm(), 5_000, inner =>
      !shouldDisable(inner, { env: { DSH_SCHEDULE_ACTIONS_ENABLED: '1' } }))
    await expect(ctx.messageDestinations.list(abortSignal())).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'wechat' }),
    ]))
  })
  it('enumerates stable versioned hashes independent of bot and target ordering', async () => {
    const firstIm = fakeIm()
    const secondIm = fakeIm({
      listBots: vi.fn(async () => [
        { botId: 'bot-private-b', channel: 'slack' },
        { botId: 'bot-private-a', channel: 'wechat' },
      ]),
    })
    const first = await mounted(firstIm)
    const second = await mounted(secondIm)

    const firstViews = await first.messageDestinations.list(abortSignal())
    const secondViews = await second.messageDestinations.list(abortSignal())

    expect(firstViews.map(item => item.ref.id).sort()).toEqual([
      hash('bot-private-a', 'target-private-a'),
      hash('bot-private-b', 'target-private-b'),
    ].sort())
    expect(secondViews.map(item => item.ref.id).sort()).toEqual(firstViews.map(item => item.ref.id).sort())
  })

  it('never exposes bot ids, target ids, or routes in public destination values', async () => {
    const ctx = await mounted(fakeIm())
    const values = await ctx.messageDestinations.list(abortSignal())
    const serialized = JSON.stringify(values)

    expect(serialized).not.toContain('bot-private')
    expect(serialized).not.toContain('target-private')
    expect(serialized).not.toContain('route-')
    expect(values).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expect.objectContaining({ provider: 'dsh-im', label: '值班群', kind: 'group' }) }),
    ]))
  })

  it('rejects forged and expired hashes after re-enumerating current targets', async () => {
    const im = fakeIm()
    const ctx = await mounted(im)
    const listed = await ctx.messageDestinations.list(abortSignal())
    const valid = listed[0]!.ref
    vi.mocked(im.listTargets).mockResolvedValue([])

    await expect(ctx.messageDestinations.resolve({ ...valid, id: 'dsh-im:v1:forged' }, abortSignal())).resolves.toBeUndefined()
    await expect(ctx.messageDestinations.resolve(valid, abortSignal())).resolves.toBeUndefined()
    expect(im.listBots).toHaveBeenCalledTimes(3)
  })

  it('re-enumerates before sending and never reroutes a missing destination', async () => {
    const im = fakeIm()
    const ctx = await mounted(im)
    const [destination] = await ctx.messageDestinations.list(abortSignal())
    vi.mocked(im.listTargets).mockResolvedValue([])

    await expect(ctx.messageDestinations.send(destination!.ref, 'hello', abortSignal())).resolves.toEqual({
      sent: false,
      code: 'destination_unavailable',
    })
    expect(im.send).not.toHaveBeenCalled()
  })

  it.each([
    ['bot-not-connected', 'destination_offline'],
    ['unknown-target', 'destination_unavailable'],
    ['delivery-failed', 'delivery_failed'],
  ])('maps DSH-IM %s without leaking its identifiers', async (upstreamCode, expectedCode) => {
    const error = Object.assign(new Error('private upstream message'), { code: upstreamCode })
    const im = fakeIm({ send: vi.fn(async () => { throw error }) })
    const ctx = await mounted(im)
    const [destination] = await ctx.messageDestinations.list(abortSignal())

    await expect(ctx.messageDestinations.send(destination!.ref, 'hello', abortSignal())).resolves.toEqual({
      sent: false,
      code: expectedCode,
    })
  })

  it('maps timeout to an unknown delivery result and maps { sent: true } exactly', async () => {
    const never = new Promise<{ sent: true }>(() => {})
    const timeoutCtx = await mounted(fakeIm({ send: vi.fn(async () => never) }), 5)
    const [timeoutDestination] = await timeoutCtx.messageDestinations.list(abortSignal())
    await expect(timeoutCtx.messageDestinations.send(timeoutDestination!.ref, 'hello', abortSignal())).resolves.toEqual({
      sent: false,
      code: 'delivery_unknown',
    })

    const successCtx = await mounted(fakeIm())
    const [successDestination] = await successCtx.messageDestinations.list(abortSignal())
    await expect(successCtx.messageDestinations.send(successDestination!.ref, 'hello', abortSignal())).resolves.toEqual({ sent: true })
  })
})
