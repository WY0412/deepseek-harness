import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertRuntimeNpmVersion, collectRuntimeTarballs, runtimeConsumerManifest, validateRuntimeLock,
} from './runtime-lock.mjs'

function packed(root, filename, manifest) {
  const source = mkdtempSync(join(tmpdir(), 'runtime-package-'))
  const packageRoot = join(source, 'package')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`)
  mkdirSync(root, { recursive: true })
  const target = join(root, filename)
  execFileSync('tar', ['-czf', target, '-C', source, 'package'])
  return target
}

test('consumer manifest uses stable relative tarball references across source roots', () => {
  const first = mkdtempSync(join(tmpdir(), 'runtime-tarballs-a-'))
  const second = mkdtempSync(join(tmpdir(), 'runtime-tarballs-b-'))
  packed(first, 'app.tgz', { name: '@deepseek-ai/dsh', version: '1.0.0' })
  packed(second, 'app.tgz', { name: '@deepseek-ai/dsh', version: '1.0.0' })

  const one = runtimeConsumerManifest(collectRuntimeTarballs([first]))
  const two = runtimeConsumerManifest(collectRuntimeTarballs([second]))
  assert.deepEqual(one, two)
  assert.equal(one.dependencies['@deepseek-ai/dsh'], 'file:tarballs/app.tgz')
})

test('runtime lock must exactly match the generated consumer dependencies', () => {
  const manifest = {
    name: 'dsh-runtime',
    version: '0.0.0',
    private: true,
    dependencies: { '@deepseek-ai/dsh': 'file:tarballs/app.tgz' },
  }
  const matching = {
    name: 'dsh-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    packages: { '': manifest },
  }
  assert.doesNotThrow(() => validateRuntimeLock(matching, manifest, []))
  assert.throws(
    () => validateRuntimeLock({ ...matching, packages: { '': { ...manifest, dependencies: {} } } }, manifest, []),
    /regenerate deploy\/runtime-package-lock.json/u,
  )
})

test('consumer lock keeps registry integrity but accepts changed local package bytes with the same dependency graph', async () => {
  const source = mkdtempSync(join(tmpdir(), 'runtime-source-'))
  packed(source, 'app.tgz', {
    name: '@deepseek-ai/dsh', version: '1.0.0', dependencies: { react: '19.0.0' }, marker: 'new bytes',
  })
  const tarballs = collectRuntimeTarballs([source])
  const manifest = runtimeConsumerManifest(tarballs)
  const lock = {
    name: 'dsh-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies },
      'node_modules/@deepseek-ai/dsh': {
        version: '1.0.0', resolved: 'file:tarballs/app.tgz', integrity: 'sha512-old', dependencies: { react: '19.0.0' },
      },
      'node_modules/react': { version: '19.0.0', integrity: 'sha512-registry' },
    },
  }
  const lockPath = join(source, 'package-lock.json')
  writeFileSync(lockPath, JSON.stringify(lock))
  const consumer = mkdtempSync(join(tmpdir(), 'runtime-consumer-'))
  const { prepareRuntimeConsumer } = await import('./runtime-lock.mjs')
  prepareRuntimeConsumer({ consumer, tarballs, lockPath })

  const materialized = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'))
  assert.equal(materialized.packages['node_modules/@deepseek-ai/dsh'].integrity, undefined)
  assert.equal(materialized.packages['node_modules/react'].integrity, 'sha512-registry')

  tarballs[0].manifest.dependencies.react = '20.0.0'
  assert.throws(
    () => prepareRuntimeConsumer({ consumer, tarballs, lockPath }),
    /regenerate deploy\/runtime-package-lock.json/u,
  )
})

test('runtime assembly pins the npm implementation that materializes the lock', () => {
  assert.doesNotThrow(() => assertRuntimeNpmVersion('11.19.0'))
  assert.throws(() => assertRuntimeNpmVersion('11.20.0'), /requires npm 11\.19\.0/u)
})
