import { writeFile } from 'node:fs/promises'
import { chromium, errors } from 'playwright'
import { expect, it } from 'vitest'
import { summarize } from './repeat-claim-summary.ts'

declare global {
  interface Window {
    dshBaselineClick(time: number): void
    dshBaselineSocket(event: string, time: number): void
    dshBaselineSend(time: number): void
  }
}

type Sample = {
  scenario: 'existing' | 'created'
  outcome: 'success' | 'timeout' | 'disconnected' | 'missing'
  phase: 'ready' | 'first_reply'
  connectedMs?: number
  readyMs?: number
  firstReplyMs?: number
}

it.runIf(process.env.DSH_REPEAT_CLAIM_BASELINE === '1')('measures released accounts through the deployed claim flow', async () => {
  const env = process.env
  const base = new URL(env.DSH_BASELINE_ORIGIN ?? '')
  const output = env.DSH_BASELINE_REPORT
  const accounts = JSON.parse(env.DSH_BASELINE_ACCOUNTS ?? '[]') as { user: string; password: string; scenario: Sample['scenario'] }[]
  if (!output || !env.DSH_BASELINE_VERSION || !env.DSH_BASELINE_LOAD || !env.DSH_BASELINE_MODEL
    || base.protocol !== 'https:' || accounts.length === 0
    || accounts.some(entry => !entry.user || !entry.password || !['existing', 'created'].includes(entry.scenario))
    || new Set(accounts.map(({ user }) => user)).size !== accounts.length) {
    throw new Error('Baseline requires HTTPS, unique preconditioned accounts, report path, version, load and model labels')
  }

  const browser = await chromium.launch()
  const rows: Sample[] = []
  try {
    for (const account of accounts) {
      const page = await browser.newPage()
      const sample: Sample = { scenario: account.scenario, outcome: 'missing', phase: 'ready' }
      let connectedAt: number | undefined
      let disconnected = false
      let clickedAt: number | undefined
      try {
        await page.exposeBinding('dshBaselineClick', (_source, time: number) => { clickedAt = time })
        await page.goto(new URL('/login', base).href)
        await page.locator('#user').fill(account.user)
        await page.locator('#password').fill(account.password)
        const submit = page.locator('form[action="/login"] button[type="submit"]')
        await submit.evaluate(node => node.addEventListener('click', () => {
          window.dshBaselineClick(performance.timeOrigin + performance.now())
        }, { once: true, capture: true }))
        await page.exposeBinding('dshBaselineSocket', (_source, event: string, time: number) => {
          if (event === 'open') connectedAt ??= time
          else if (connectedAt !== undefined) disconnected = true
        })
        await page.addInitScript((apex) => {
          window.WebSocket = new Proxy(window.WebSocket, {
            construct(target, args, newTarget) {
              const socket: WebSocket = Reflect.construct(target, args, newTarget)
              const url = new URL(socket.url)
              if (url.pathname === '/api/remote.mux' && (url.hostname === apex || url.hostname.endsWith('.' + apex))) {
                for (const event of ['open', 'close']) socket.addEventListener(event, () => {
                  window.dshBaselineSocket(event, performance.timeOrigin + performance.now())
                }, { once: true })
              }
              return socket
            },
          })
        }, base.hostname)
        await submit.click({ timeout: 15_000 })
        const composer = page.locator('[data-composer-input][contenteditable="true"]')
        await composer.waitFor({ state: 'visible', timeout: 45_000 })
        await composer.pressSequentially('?', { timeout: 45_000 })
        const send = page.getByRole('button', { name: /^(发送消息|Send message)$/ })
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(
          button => !button.disabled && /^(发送消息|Send message)$/.test(button.getAttribute('aria-label') ?? ''),
        ), undefined, { timeout: 45_000 })
        const readyAt = await page.evaluate(() => performance.timeOrigin + performance.now())
        if (clickedAt === undefined || readyAt < clickedAt) continue
        sample.readyMs = readyAt - clickedAt
        sample.phase = 'first_reply'
        // The controlled backend must respond to this prompt with the fixed marker below.
        const marker = 'BASELINE_REPLY_OK'
        const known = await page.getByText(marker, { exact: true }).evaluateAll(nodes =>
          nodes.map(node => node.closest('[data-chat-anchor-key]')?.getAttribute('data-chat-anchor-key')).filter(Boolean),
        )
        let sentAt: number | undefined
        await page.exposeBinding('dshBaselineSend', (_source, time: number) => { sentAt = time })
        await send.evaluate(node => node.addEventListener('click', () => {
          window.dshBaselineSend(performance.timeOrigin + performance.now())
        }, { once: true, capture: true }))
        await send.click({ timeout: 45_000 })
        const fresh = page.locator('[data-chat-node-key][data-chat-anchor-key]').filter({ has: page.getByText(marker, { exact: true }) })
        const exclude = known.map(key => '[data-chat-anchor-key=' + JSON.stringify(key) + ']').join(',')
        const reply = (exclude ? fresh.and(page.locator(':not(' + exclude + ')')) : fresh)
          .getByText(marker, { exact: true }).last()
        await reply.waitFor({ state: 'visible', timeout: 45_000 })
        const replyAt = await page.evaluate(() => performance.timeOrigin + performance.now())
        if (sentAt !== undefined && replyAt >= sentAt) {
          sample.firstReplyMs = replyAt - sentAt
          sample.outcome = 'success'
        }
      } catch (error) {
        sample.outcome = disconnected ? 'disconnected' : error instanceof errors.TimeoutError ? 'timeout' : 'missing'
      } finally {
        if (connectedAt !== undefined && clickedAt !== undefined && connectedAt >= clickedAt) {
          sample.connectedMs = connectedAt - clickedAt
        }
        rows.push(sample)
        await page.context().close()
      }
    }
  } finally {
    await browser.close()
    const groups = Object.fromEntries(['existing', 'created'].map((scenario) => {
      const group = rows.filter(row => row.scenario === scenario)
      return [scenario, { connection: summarize(group, 'connectedMs'), ready: summarize(group, 'readyMs'), firstReply: summarize(group, 'firstReplyMs') }]
    }))
    await writeFile(output, JSON.stringify({
      version: env.DSH_BASELINE_VERSION, load: env.DSH_BASELINE_LOAD, model: env.DSH_BASELINE_MODEL, groups, samples: rows,
    }, null, 2))
  }
  expect(rows.some(row => row.outcome === 'success')).toBe(true)
}, 900_000)
