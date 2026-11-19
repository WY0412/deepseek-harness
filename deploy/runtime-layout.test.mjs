import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pruneRuntime, runtimeInventory, splitRuntime } from './runtime-layout.mjs'

function temporary(name) {
  return mkdtempSync(join(tmpdir(), `${name}-`))
}

function file(path, contents, mode) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, mode === undefined ? undefined : { mode })
}

test('same content ignores mtime and temporary root in baseKey', () => {
  const first = temporary('runtime-first')
  const second = temporary('runtime-second')
  file(join(first, 'pkg', 'index.js'), 'export const value = 1\n', 0o755)
  file(join(second, 'pkg', 'index.js'), 'export const value = 1\n', 0o755)
  utimesSync(join(first, 'pkg', 'index.js'), new Date(1_000), new Date(1_000))
  utimesSync(join(second, 'pkg', 'index.js'), new Date(9_000), new Date(9_000))

  const one = runtimeInventory({ base: first, app: temporary('app-one'), nodeBaseDigest: 'sha256:node' })
  const two = runtimeInventory({ base: second, app: temporary('app-two'), nodeBaseDigest: 'sha256:node' })
  assert.equal(one.baseKey, two.baseKey)
})

test('base content or node digest changes baseKey but app content does not', () => {
  const base = temporary('runtime-base')
  const app = temporary('runtime-app')
  file(join(base, 'external', 'index.js'), 'one')
  file(join(app, 'dsh', 'index.js'), 'first')
  const initial = runtimeInventory({ base, app, nodeBaseDigest: 'sha256:node-a' })

  file(join(app, 'dsh', 'index.js'), 'second')
  const appChanged = runtimeInventory({ base, app, nodeBaseDigest: 'sha256:node-a' })
  assert.equal(appChanged.baseKey, initial.baseKey)
  assert.notEqual(appChanged.appBytes, initial.appBytes)

  file(join(base, 'external', 'index.js'), 'two')
  const baseChanged = runtimeInventory({ base, app, nodeBaseDigest: 'sha256:node-a' })
  assert.notEqual(baseChanged.baseKey, initial.baseKey)
  const nodeChanged = runtimeInventory({ base, app, nodeBaseDigest: 'sha256:node-b' })
  assert.notEqual(nodeChanged.baseKey, baseChanged.baseKey)
})

test('mixed @deepseek-ai scope splits exact DSH package names from vendor names', () => {
  const root = temporary('runtime-split')
  const source = join(root, 'source')
  const base = join(root, 'base')
  const app = join(root, 'app')
  file(join(source, '@deepseek-ai', 'dsh', 'package.json'), '{"name":"@deepseek-ai/dsh"}')
  file(join(source, '@deepseek-ai', 'cordis', 'package.json'), '{"name":"@deepseek-ai/cordis"}')
  file(join(source, 'react', 'package.json'), '{"name":"react"}')

  const stats = splitRuntime({ source, base, app, appPackages: new Set(['@deepseek-ai/dsh']) })
  assert.equal(readFileSync(join(app, '@deepseek-ai', 'dsh', 'package.json'), 'utf8').includes('dsh'), true)
  assert.equal(readFileSync(join(base, '@deepseek-ai', 'cordis', 'package.json'), 'utf8').includes('cordis'), true)
  assert.equal(readFileSync(join(base, 'react', 'package.json'), 'utf8').includes('react'), true)
  assert.deepEqual(stats.packageCounts, { base: 2, app: 1 })
})

test('.bin relative symlinks remain valid in merged base/app view', () => {
  const root = temporary('runtime-bin')
  const source = join(root, 'source')
  const base = join(root, 'base')
  const app = join(root, 'app')
  file(join(source, '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  mkdirSync(join(source, '.bin'), { recursive: true })
  symlinkSync('../@deepseek-ai/dsh/lib/bin.js', join(source, '.bin', 'dsh'))

  splitRuntime({ source, base, app, appPackages: new Set(['@deepseek-ai/dsh']) })
  assert.equal(readFileSync(join(app, '.bin', 'dsh'), 'utf8'), '#!/usr/bin/env node\n')
})

test('cache directories and source maps are removed while declarations docs and licenses remain', () => {
  const root = temporary('runtime-prune')
  file(join(root, '.npm-cache', 'blob'), 'cache')
  file(join(root, 'pkg', '.cache', 'blob'), 'nested')
  file(join(root, 'pkg', 'index.js.map'), 'source-map')
  file(join(root, 'pkg', 'index.d.ts'), 'export declare const value: number\n')
  file(join(root, 'pkg', 'README.md'), 'docs')
  file(join(root, 'pkg', 'LICENSE'), 'license')

  const removed = pruneRuntime(root)
  assert.equal(removed.cacheBytes, 11)
  assert.equal(removed.sourceMapBytes, 10)
  assert.equal(readFileSync(join(root, 'pkg', 'index.d.ts'), 'utf8').includes('declare'), true)
  assert.equal(readFileSync(join(root, 'pkg', 'README.md'), 'utf8'), 'docs')
  assert.equal(readFileSync(join(root, 'pkg', 'LICENSE'), 'utf8'), 'license')
})
