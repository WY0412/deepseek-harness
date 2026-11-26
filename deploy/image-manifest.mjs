import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MAXIMUM_LAYER_BYTES = 300 * 1024 * 1024

export function assertBasePrefix(baseManifest, finalManifest) {
  const candidate = layers(finalManifest)
  for (const [index, layer] of layers(baseManifest).entries()) {
    if (candidate[index]?.digest !== layer.digest || candidate[index].size !== layer.size) {
      throw new Error(`candidate does not preserve baseline layer ${index}: ${layer.digest}`)
    }
  }
}

export function diffManifests(baseManifest, finalManifest) {
  const baseDigests = new Set(layers(baseManifest).map(layer => layer.digest))
  const newLayers = []
  const seen = new Set()

  for (const layer of layers(finalManifest)) {
    if (baseDigests.has(layer.digest) || seen.has(layer.digest)) continue
    seen.add(layer.digest)
    newLayers.push(layer)
  }

  return {
    totalBytes: newLayers.reduce((total, layer) => total + layer.size, 0),
    maximumLayerBytes: Math.max(0, ...newLayers.map(layer => layer.size)),
    newLayerDigests: newLayers.map(layer => layer.digest),
  }
}

function layers(manifest) {
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray(manifest.layers)) {
    throw new TypeError('Image manifest must contain a layers array')
  }
  return manifest.layers.map(layer => {
    if (typeof layer?.digest !== 'string' || !Number.isSafeInteger(layer.size) || layer.size < 0) {
      throw new TypeError('Each image layer must have a digest and a non-negative integer size')
    }
    return { digest: layer.digest, size: layer.size }
  })
}

function main(argv) {
  const [command, basePath, finalPath] = argv
  if (!['diff', 'verify'].includes(command) || basePath === undefined || finalPath === undefined) {
    throw new Error('Usage: image-manifest.mjs <diff|verify> <base-manifest-json> <final-manifest-json>')
  }
  const base = readJson(basePath)
  const final = readJson(finalPath)
  if (command === 'verify') assertBasePrefix(base, final)
  const result = diffManifests(base, final)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.maximumLayerBytes > MAXIMUM_LAYER_BYTES) {
    process.stderr.write(`Largest new layer ${result.maximumLayerBytes} exceeds ${MAXIMUM_LAYER_BYTES} bytes\n`)
    process.exitCode = 1
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
