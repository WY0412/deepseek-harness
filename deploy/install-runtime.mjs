// Install packed tarballs into one directory the runtime image copies.
// The bulk install omits optional packages, so darwin, musl, and the large
// platform payloads stay out. Web startup still needs the prebuilt glibc
// addons for this image. Those packages are named *-linux-x64-gnu and are
// fetched afterwards for linux x64 glibc, not for the machine running this script.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const GNU_ADDON = 'node-addon-require-builtin-linux-x64-gnu'

function linuxGnuOptional(root) {
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
        if (!dep.endsWith('linux-x64-gnu')) continue
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
    const specs = linuxGnuOptional(root)
    if (specs.join() !== `@rolldown/binding-linux-x64-gnu@1.2.7,${GNU_ADDON}@0.1.9`) {
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
      linuxGnuOptional(root)
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

const dependencies = {}
for (const directory of directories) {
  const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
  if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
  for (const filename of tarballs) {
    const tarball = join(directory, filename)
    const json = execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
    const name = JSON.parse(json).name
    if (typeof name !== 'string' || name === '') throw new Error(`${tarball} has no package name`)
    dependencies[name] = pathToFileURL(tarball).href
  }
}

const consumer = mkdtempSync(join(tmpdir(), 'dsh-runtime-'))
try {
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'dsh-runtime',
    version: '0.0.0',
    private: true,
    dependencies,
  }, null, 2)}\n`)
  const npmInstall = (args) => execFileSync('npm', [
    'install',
    '--cache', join(consumer, '.npm-cache'),
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--loglevel=error',
    ...args,
  ], { cwd: consumer, stdio: 'inherit' })
  npmInstall(['--omit=optional'])
  const gnu = linuxGnuOptional(join(consumer, 'node_modules'))
  if (!gnu.some(spec => spec.startsWith(`${GNU_ADDON}@`))) {
    throw new Error(`runtime install did not select ${GNU_ADDON}`)
  }
  npmInstall(['--no-save', '--os=linux', '--cpu=x64', '--libc=glibc', ...gnu])
  execFileSync('rm', ['-rf', destination])
  execFileSync('mkdir', ['-p', destination])
  execFileSync('cp', ['-a', join(consumer, 'node_modules'), join(destination, 'node_modules')])
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
