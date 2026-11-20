// Install packed tarballs into one directory the runtime image copies.
// The bulk install omits optional packages, so darwin, musl, and the large
// platform payloads stay out. Web startup still needs the prebuilt glibc
// addons for this image. Those packages are selected explicitly and fetched
// afterwards for linux x64 glibc, not for the machine running this script.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruneRuntime, runtimeInventory, splitRuntime } from './runtime-layout.mjs'
import { assertRuntimeNpmVersion, collectRuntimeTarballs, prepareRuntimeConsumer } from './runtime-lock.mjs'

const GNU_ADDON = 'node-addon-require-builtin-linux-x64-gnu'
const KOFFI_ADDON = '@koromix/koffi-linux-x64'

function linuxRuntimeOptional(root) {
  const specs = new Map()
  const visit = (dir) => {
    let names
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      if (name === '.bin') continue
      const child = join(dir, name)
      let info
      try { info = statSync(child) } catch { continue }
      if (!info.isDirectory()) continue
      if (name === 'node_modules' || name.startsWith('@')) {
        visit(child)
        continue
      }
      let manifest
      try { manifest = JSON.parse(readFileSync(join(child, 'package.json'), 'utf8')) } catch { continue }
      for (const [dep, version] of Object.entries(manifest.optionalDependencies ?? {})) {
        if (!dep.endsWith('linux-x64-gnu') && dep !== KOFFI_ADDON) continue
        if (typeof version !== 'string' || version === '') throw new Error(`${manifest.name ?? child} optional ${dep} has no version`)
        const previous = specs.get(dep)
        if (previous !== undefined && previous !== version) throw new Error(`${dep} is wanted at ${previous} and ${version}`)
        specs.set(dep, version)
      }
      visit(join(child, 'node_modules'))
    }
  }
  visit(root)
  return [...specs].map(([name, version]) => `${name}@${version}`).sort()
}

if (process.argv[2] === '--self-check') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gnu-'))
  const write = (dir, manifest) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  }
  try {
    write(join(root, 'node-addon-require-builtin'), {
      name: 'node-addon-require-builtin',
      optionalDependencies: {
        [GNU_ADDON]: '0.1.9',
        'node-addon-require-builtin-linux-x64-musl': '0.1.9',
      },
    })
    write(join(root, '@rolldown', 'binding'), {
      name: 'rolldown',
      optionalDependencies: { '@rolldown/binding-linux-x64-gnu': '1.2.7' },
    })
    write(join(root, '@anthropic-ai', 'claude-agent-sdk'), {
      name: '@anthropic-ai/claude-agent-sdk',
      optionalDependencies: { '@anthropic-ai/claude-agent-sdk-linux-x64': '0.3.263' },
    })
    write(join(root, 'koffi'), {
      name: 'koffi',
      optionalDependencies: { [KOFFI_ADDON]: '3.1.1' },
    })
    const specs = linuxRuntimeOptional(root)
    if (specs.join() !== `${KOFFI_ADDON}@3.1.1,@rolldown/binding-linux-x64-gnu@1.2.7,${GNU_ADDON}@0.1.9`) {
      throw new Error(`scan selected ${specs.join()}`)
    }
    write(join(root, 'lightningcss'), {
      name: 'lightningcss',
      optionalDependencies: { 'lightningcss-linux-x64-gnu': '1.0.0' },
    })
    write(join(root, 'lightningcss', 'node_modules', 'other'), {
      name: 'other',
      optionalDependencies: { 'lightningcss-linux-x64-gnu': '2.0.0' },
    })
    try {
      linuxRuntimeOptional(root)
      throw new Error('version conflict was accepted')
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('lightningcss-linux-x64-gnu')) throw error
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  process.exit(0)
}

const destination = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
const directories = process.argv.slice(3).map(directory => resolve(directory))
if (destination === undefined || directories.length === 0) {
  throw new Error('usage: install-runtime.mjs <destination> <tarball directory>...')
}

const tarballs = collectRuntimeTarballs(directories)
const applicationPackages = new Set(tarballs.filter(entry => entry.application).map(entry => entry.name))

const consumer = mkdtempSync(join(tmpdir(), 'dsh-runtime-'))
try {
  assertRuntimeNpmVersion(execFileSync('npm', ['--version'], { encoding: 'utf8' }))
  const lockPath = fileURLToPath(new URL('./runtime-package-lock.json', import.meta.url))
  prepareRuntimeConsumer({ consumer, tarballs, lockPath })
  const lockDigest = () => createHash('sha256').update(readFileSync(join(consumer, 'package-lock.json'))).digest('hex')
  const expectedLockDigest = lockDigest()
  const npm = (command, args) => execFileSync('npm', [
    command,
    '--cache', join(consumer, '.npm-cache'),
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    ...args,
  ], { cwd: consumer, stdio: 'inherit' })
  npm('ci', ['--ignore-scripts', '--omit=optional'])
  const platformPackages = linuxRuntimeOptional(join(consumer, 'node_modules'))
  if (!platformPackages.some(spec => spec.startsWith(`${GNU_ADDON}@`))) {
    throw new Error(`runtime install did not select ${GNU_ADDON}`)
  }
  npm('install', ['--ignore-scripts', '--no-save', '--os=linux', '--cpu=x64', '--libc=glibc', ...platformPackages])
  npm('rebuild', [])
  if (lockDigest() !== expectedLockDigest) throw new Error('runtime install changed the locked dependency graph')
  const runtimeRoot = join(consumer, 'node_modules')
  const removed = pruneRuntime(runtimeRoot)
  execFileSync('rm', ['-rf', destination])
  const base = join(destination, 'base', 'node_modules')
  const app = join(destination, 'app', 'node_modules')
  const split = splitRuntime({ source: runtimeRoot, base, app, appPackages: applicationPackages })
  const dsh = join(app, '.bin', 'dsh')
  try {
    statSync(dsh)
  } catch {
    throw new Error('runtime application overlay has no executable .bin/dsh')
  }
  const nodeBaseDigest = process.env.DSH_NODE_BASE_DIGEST
  if (nodeBaseDigest === undefined) throw new Error('DSH_NODE_BASE_DIGEST is required')
  const inventory = runtimeInventory({ base, app, nodeBaseDigest, removed })
  if (JSON.stringify(inventory.packageCounts) !== JSON.stringify(split.packageCounts)) {
    throw new Error('runtime package counts changed while inventory was written')
  }
  const inventoryPath = join(destination, 'runtime-inventory.json')
  const temporaryInventory = `${inventoryPath}.tmp`
  writeFileSync(temporaryInventory, `${JSON.stringify(inventory, null, 2)}\n`)
  renameSync(temporaryInventory, inventoryPath)
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
