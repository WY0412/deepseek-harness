// Install packed tarballs into one directory the runtime image copies.
// Optional platform packages stay out: they need a per-arch toolchain, and
// the published install treats them as optional.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  execFileSync('npm', [
    'install',
    '--cache', join(consumer, '.npm-cache'),
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--omit=optional',
    '--loglevel=error',
  ], { cwd: consumer, stdio: 'inherit' })
  execFileSync('rm', ['-rf', destination])
  execFileSync('mkdir', ['-p', destination])
  execFileSync('cp', ['-a', join(consumer, 'node_modules'), join(destination, 'node_modules')])
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
