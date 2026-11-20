import { execFileSync } from 'node:child_process'
import {
  copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME_NPM_VERSION = '11.19.0'
const LOCKED_MANIFEST_FIELDS = [
  'version', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'bundleDependencies', 'os', 'cpu', 'libc',
]

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, child]) => [key, stable(child)],
  ))
}

function lockedManifest(manifest) {
  const normalized = { ...manifest }
  if (normalized.bundleDependencies === undefined && normalized.bundledDependencies !== undefined) {
    normalized.bundleDependencies = normalized.bundledDependencies
  }
  return Object.fromEntries(LOCKED_MANIFEST_FIELDS.flatMap((field) => {
    const value = normalized[field]
    if (value === undefined || (Array.isArray(value) && value.length === 0)
      || (value !== null && typeof value === 'object' && Object.keys(value).length === 0)) return []
    return [[field, stable(value)]]
  }))
}

export function assertRuntimeNpmVersion(version) {
  if (version.trim() !== RUNTIME_NPM_VERSION) {
    throw new Error(`runtime assembly requires npm ${RUNTIME_NPM_VERSION}; received ${version.trim()}`)
  }
}

export function collectRuntimeTarballs(directories) {
  const entries = []
  const filenames = new Set()
  const packageNames = new Set()
  for (const [index, directory] of directories.entries()) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      if (filenames.has(filename)) throw new Error(`runtime tarball filename is duplicated: ${filename}`)
      const source = join(directory, filename)
      const json = execFileSync('tar', ['-xOf', source, 'package/package.json'], { encoding: 'utf8' })
      const manifest = JSON.parse(json)
      const name = manifest.name
      if (typeof name !== 'string' || name === '') throw new Error(`${source} has no package name`)
      if (packageNames.has(name)) throw new Error(`runtime package name is duplicated: ${name}`)
      filenames.add(filename)
      packageNames.add(name)
      entries.push({ name, filename, source, manifest, application: index === 0 })
    }
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

export function runtimeConsumerManifest(tarballs) {
  return {
    name: 'dsh-runtime',
    version: '0.0.0',
    private: true,
    dependencies: Object.fromEntries(tarballs.map(({ name, filename }) => [name, `file:tarballs/${filename}`])),
  }
}

export function validateRuntimeLock(lock, manifest, tarballs) {
  const root = lock?.packages?.['']
  const sameDependencies = JSON.stringify(root?.dependencies) === JSON.stringify(manifest.dependencies)
  if (lock?.lockfileVersion !== 3 || root?.name !== manifest.name || root?.version !== manifest.version || !sameDependencies) {
    throw new Error('runtime packages changed; regenerate deploy/runtime-package-lock.json')
  }
  for (const { name, manifest: packageManifest } of tarballs) {
    const locked = lock.packages[`node_modules/${name}`]
    if (JSON.stringify(lockedManifest(locked ?? {})) !== JSON.stringify(lockedManifest(packageManifest))) {
      throw new Error(`runtime package ${name} dependencies changed; regenerate deploy/runtime-package-lock.json`)
    }
  }
}

export function prepareRuntimeConsumer({ consumer, tarballs, lockPath }) {
  const manifest = runtimeConsumerManifest(tarballs)
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  validateRuntimeLock(lock, manifest, tarballs)
  for (const { name } of tarballs) delete lock.packages[`node_modules/${name}`].integrity
  const tarballRoot = join(consumer, 'tarballs')
  mkdirSync(tarballRoot, { recursive: true })
  for (const { filename, source } of tarballs) copyFileSync(source, join(tarballRoot, filename))
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(consumer, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
  return manifest
}

function refreshLock(output, directories) {
  const consumer = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    assertRuntimeNpmVersion(execFileSync('npm', ['--version'], { encoding: 'utf8' }))
    const tarballs = collectRuntimeTarballs(directories)
    const manifest = runtimeConsumerManifest(tarballs)
    const tarballRoot = join(consumer, 'tarballs')
    mkdirSync(tarballRoot, { recursive: true })
    for (const { filename, source } of tarballs) copyFileSync(source, join(tarballRoot, filename))
    writeFileSync(join(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    execFileSync('npm', [
      'install', '--package-lock-only', '--lockfile-version=3', '--ignore-scripts', '--no-audit', '--no-fund',
      '--cache', join(consumer, '.npm-cache'),
    ], { cwd: consumer, stdio: 'inherit' })
    copyFileSync(join(consumer, 'package-lock.json'), output)
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write' || process.argv.length < 5) {
    throw new Error(`usage: ${basename(process.argv[1])} --write <lock path> <tarball directory>...`)
  }
  refreshLock(resolve(process.argv[3]), process.argv.slice(4).map(directory => resolve(directory)))
}
