import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { stageRuntimeDelta } from './runtime-delta.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-delta-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dirs = Object.fromEntries(['baseline', 'target', 'app', 'output'].map(name => [name, join(root, name)]))
  for (const name of ['baseline', 'target', 'app']) mkdirSync(dirs[name])
  const put = (tree, path, body) => {
    const file = join(dirs[tree], path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  put('baseline', '@vendor/old/package.json', '{}')
  put('target', '@vendor/old/package.json', '{}')
  return { dirs, put }
}

test('copies a complete new scoped package and leaves the existing package in the base', t => {
  const { dirs, put } = fixture(t)
  put('target', '@vendor/new/package.json', '{}')
  put('target', '@vendor/new/index.js', 'new')
  assert.deepEqual(stageRuntimeDelta(dirs), { addedPackages: ['@vendor/new'], addedBytes: 5 })
  assert.equal(readFileSync(join(dirs.output, '@vendor/new/index.js'), 'utf8'), 'new')
  assert.equal(existsSync(join(dirs.output, '@vendor/old')), false)
})

test('a later candidate with no additions generates an empty extension', t => {
  const { dirs } = fixture(t)
  assert.deepEqual(stageRuntimeDelta(dirs), { addedPackages: [], addedBytes: 0 })
})

for (const [name, mutate] of [
  ['changed old file', ({ put }) => put('target', '@vendor/old/package.json', '{"changed":true}')],
  ['removed old file', ({ dirs }) => rmSync(join(dirs.target, '@vendor/old/package.json'))],
  ['addition inside old package', ({ put }) => put('target', '@vendor/old/new.js', 'new')],
  ['changed baseline mode', ({ dirs }) => chmodSync(join(dirs.target, '@vendor/old/package.json'), 0o600)],
  ['application package collision', ({ put }) => put('app', '@vendor/old/package.json', '{}')],
  ['escaping link', ({ dirs, put }) => {
    put('target', 'new/package.json', '{}')
    symlinkSync('../../../outside', join(dirs.target, 'new/link'))
  }],
]) {
  test(`rejects ${name} before writing an extension`, t => {
    const input = fixture(t)
    mutate(input)
    assert.throws(() => stageRuntimeDelta(input.dirs), /runtime delta:/)
    assert.equal(existsSync(input.dirs.output), false)
  })
}

test('preserves relative links that resolve across application and dependency directories', t => {
  const { dirs } = fixture(t)
  mkdirSync(join(dirs.app, '.bin'))
  symlinkSync('../@vendor/old/package.json', join(dirs.app, '.bin', 'old'))
  assert.deepEqual(stageRuntimeDelta(dirs), { addedPackages: [], addedBytes: 0 })
})
