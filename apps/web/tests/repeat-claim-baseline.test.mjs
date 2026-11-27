import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'

test('baseline keeps failed attempts in the denominator and reports percentiles on observed durations', async () => {
  assert.ok((await readdir(new URL('.', import.meta.url))).includes('repeat-claim-summary.mjs'))
  const { summarize } = await import('./repeat-claim-summary.mjs')
  assert.deepEqual(summarize([{ outcome: 'success', readyMs: 3 }, { outcome: 'timeout' }, { outcome: 'success', readyMs: 9 }], 'readyMs'),
    { samples: 3, observed: 2, successRate: 2 / 3, p50: 3, p95: 9 })
})

test('a reply timeout does not erase the earlier successful readiness measurement', async () => {
  const { summarize } = await import('./repeat-claim-summary.mjs')
  const samples = [{ outcome: 'timeout', readyMs: 15 }]
  assert.equal(summarize(samples, 'readyMs').successRate, 1)
  assert.equal(summarize(samples, 'firstReplyMs').successRate, 0)
})
