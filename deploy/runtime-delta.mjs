import { createHash } from 'node:crypto'
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function fail(reason, path) {
  throw new Error(`runtime delta: ${reason}: ${path}`)
}

function inside(root, path) {
  const name = relative(root, path)
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

function scan(root) {
  const entries = new Map()
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const key = prefix + name
      const path = join(directory, name)
      const info = lstatSync(path)
      const mode = info.mode & 0o7777
      if (info.isDirectory()) {
        entries.set(key, { type: 'directory', mode })
        visit(path, key + '/')
      } else if (info.isSymbolicLink()) {
        const link = readlinkSync(path)
        if (isAbsolute(link) || !inside(root, resolve(dirname(path), link))) fail('escaping link', key)
        entries.set(key, { type: 'link', mode, link })
      } else if (info.isFile()) {
        const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
        entries.set(key, { type: 'file', mode, digest, bytes: info.size })
      } else {
        fail('unsupported file type', key)
      }
    }
  }
  visit(root)
  return entries
}

function packageRoot(path) {
  const parts = path.split('/')
  if (!path.startsWith('@')) return parts[0]
  return parts.length > 1 ? parts.slice(0, 2).join('/') : undefined
}

/** Stage only complete new packages after verifying the baseline and merged layout. */
export function stageRuntimeDelta({ baseline, target, app, output }) {
  const oldEntries = scan(realpathSync(baseline))
  const nextEntries = scan(realpathSync(target))
  const appEntries = scan(realpathSync(app))
  for (const [path, entry] of oldEntries) {
    if (JSON.stringify(entry) !== JSON.stringify(nextEntries.get(path))) fail('baseline path changed', path)
  }
  const added = new Set()
  let addedBytes = 0
  for (const [path, entry] of nextEntries) {
    if (oldEntries.has(path)) continue
    const name = packageRoot(path)
    if (name === undefined && entry.type === 'directory') continue
    if (name === undefined || oldEntries.has(name)) fail('addition inside baseline package', path)
    if (nextEntries.get(name)?.type !== 'directory' || nextEntries.get(name + '/package.json')?.type !== 'file') {
      fail('addition is not a complete package', path)
    }
    added.add(name)
    addedBytes += entry.bytes ?? (entry.link === undefined ? 0 : Buffer.byteLength(entry.link))
  }
  for (const [path, entry] of appEntries) {
    const name = packageRoot(path)
    const dependency = nextEntries.get(path)
    if ((name !== undefined && nextEntries.has(name)) ||
        (dependency !== undefined && (entry.type !== 'directory' || dependency.type !== 'directory'))) {
      fail('application and dependency collision', path)
    }
  }
  const combined = new Map([...nextEntries, ...appEntries])
  for (const [path, entry] of combined) {
    if (entry.type !== 'link') continue
    let parts = path.split('/')
    const followed = new Set()
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts.slice(0, index + 1).join('/')
      const current = combined.get(key)
      if (current === undefined) fail('unresolved link', path)
      if (current.type !== 'link') continue
      if (followed.has(key)) fail('cyclic link', path)
      followed.add(key)
      const virtualRoot = resolve('/runtime')
      const resolved = resolve(virtualRoot, dirname(key), current.link, ...parts.slice(index + 1))
      if (!inside(virtualRoot, resolved)) fail('escaping link', path)
      parts = relative(virtualRoot, resolved).split(sep)
      index = -1
    }
  }
  mkdirSync(output)
  const addedPackages = [...added].sort()
  for (const name of addedPackages) {
    const destination = join(output, name)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(target, name), destination, { recursive: true, verbatimSymlinks: true })
  }
  return { addedPackages, addedBytes }
}
