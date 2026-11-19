import { createHash } from 'node:crypto'
import {
  cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const CACHE_DIRECTORIES = new Set(['.npm', '.npm-cache', '.pnpm-store', '.cache'])

function byteSize(path) {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) return Buffer.byteLength(readlinkSync(path))
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  return readdirSync(path).reduce((total, name) => total + byteSize(join(path, name)), 0)
}

function visit(root, callback) {
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name)
    const info = lstatSync(path)
    if (callback(path, name, info) === false) continue
    if (info.isDirectory()) visit(path, callback)
  }
}

export function pruneRuntime(root) {
  const removed = { cacheBytes: 0, sourceMapBytes: 0 }
  visit(root, (path, name, info) => {
    if (info.isDirectory() && CACHE_DIRECTORIES.has(name)) {
      removed.cacheBytes += byteSize(path)
      rmSync(path, { recursive: true, force: true })
      return false
    }
    if (info.isFile() && name.endsWith('.map')) {
      removed.sourceMapBytes += info.size
      rmSync(path, { force: true })
      return false
    }
    return true
  })
  return removed
}

function move(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  try {
    renameSync(source, destination)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    cpSync(source, destination, { recursive: true, verbatimSymlinks: true })
    rmSync(source, { recursive: true, force: true })
  }
}

function packageCount(root) {
  let count = 0
  for (const name of readdirSync(root)) {
    if (name === '.bin') continue
    const path = join(root, name)
    if (!lstatSync(path).isDirectory()) continue
    if (!name.startsWith('@')) count += 1
    else count += readdirSync(path).filter(child => lstatSync(join(path, child)).isDirectory()).length
  }
  return count
}

export function splitRuntime({ source, base, app, appPackages }) {
  mkdirSync(base, { recursive: true })
  mkdirSync(app, { recursive: true })
  const foundApps = new Set()
  for (const name of readdirSync(source).sort()) {
    const path = join(source, name)
    if (name === '.bin') {
      move(path, join(app, name))
      continue
    }
    if (name.startsWith('@') && lstatSync(path).isDirectory()) {
      for (const child of readdirSync(path).sort()) {
        const packageName = `${name}/${child}`
        const targetRoot = appPackages.has(packageName) ? app : base
        if (targetRoot === app) foundApps.add(packageName)
        move(join(path, child), join(targetRoot, name, child))
      }
      rmSync(path, { recursive: true, force: true })
      continue
    }
    const targetRoot = appPackages.has(name) ? app : base
    if (targetRoot === app) foundApps.add(name)
    move(path, join(targetRoot, name))
  }
  const missing = [...appPackages].filter(name => !foundApps.has(name)).sort()
  if (missing.length > 0) throw new Error(`runtime is missing application packages: ${missing.join(', ')}`)
  return { packageCounts: { base: packageCount(base), app: packageCount(app) } }
}

function treeRecords(root) {
  const records = []
  visit(root, (path, _name, info) => {
    const name = relative(root, path).split(sep).join('/')
    const mode = info.mode & 0o7777
    if (info.isDirectory()) records.push(`${name}\0directory\0${mode.toString(8)}\0`)
    else if (info.isSymbolicLink()) records.push(`${name}\0symlink\0${mode.toString(8)}\0${readlinkSync(path)}\0`)
    else if (info.isFile()) {
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
      records.push(`${name}\0file\0${mode.toString(8)}\0${digest}\0`)
    } else records.push(`${name}\0other\0${mode.toString(8)}\0`)
    return true
  })
  return records.sort()
}

export function runtimeInventory({ base, app, nodeBaseDigest, removed = { cacheBytes: 0, sourceMapBytes: 0 } }) {
  if (!/^sha256:[0-9A-Za-z._-]+$/u.test(nodeBaseDigest)) throw new Error('node base digest is invalid')
  const hash = createHash('sha256')
  hash.update(`node-base\0${nodeBaseDigest}\0`)
  for (const record of treeRecords(base)) hash.update(record)
  return {
    schemaVersion: 1,
    baseKey: `sha256:${hash.digest('hex')}`,
    nodeBaseDigest,
    baseBytes: byteSize(base),
    appBytes: byteSize(app),
    removed,
    packageCounts: { base: packageCount(base), app: packageCount(app) },
  }
}
