import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { diffManifests } from './image-manifest.mjs'

const layer = (digest, size) => ({ digest: `sha256:${digest}`, size })

test('excludes base layers and counts duplicate final digests once', () => {
  const result = diffManifests(
    { layers: [layer('base', 100)] },
    { layers: [layer('base', 100), layer('app', 200), layer('app', 200), layer('meta', 50)] },
  )

  assert.deepEqual(result, {
    totalBytes: 250,
    maximumLayerBytes: 200,
    newLayerDigests: ['sha256:app', 'sha256:meta'],
  })
})

test('diff command fails when a new layer exceeds 300 MiB', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-image-manifest-'))
  const base = join(directory, 'base.json')
  const final = join(directory, 'final.json')
  writeFileSync(base, JSON.stringify({ layers: [] }))
  writeFileSync(final, JSON.stringify({ layers: [layer('too-large', 314572801)] }))

  const result = spawnSync(process.execPath, ['deploy/image-manifest.mjs', 'diff', base, final], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /"maximumLayerBytes":314572801/)
  assert.match(result.stderr, /exceeds 314572800 bytes/)
})
