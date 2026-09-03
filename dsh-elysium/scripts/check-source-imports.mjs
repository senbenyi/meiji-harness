/** Verify every relative source/test import still resolves after structural moves. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(root, 'src')
const extensions = new Set(['.js', '.mjs', '.ts', '.tsx'])
const files = []

const forbiddenDependencies = {
  domain: new Set(['application', 'bootstrap', 'infrastructure', 'presentation', 'public']),
  application: new Set(['bootstrap', 'presentation', 'public']),
  infrastructure: new Set(['application', 'bootstrap', 'presentation', 'public']),
}

function sourceLayer(target) {
  const relative = path.relative(sourceRoot, target)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return relative.split(path.sep)[0]
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (extensions.has(path.extname(entry.name))) files.push(target)
  }
}

for (const directory of ['src', 'tests', 'scripts']) walk(path.join(root, directory))

const patterns = [
  /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
]
const missing = []
const boundaryViolations = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = path.resolve(path.dirname(file), match[1])
      if (!fs.existsSync(target)) missing.push(`${path.relative(root, file)} -> ${match[1]}`)
      const ownerLayer = sourceLayer(file)
      const targetLayer = sourceLayer(target)
      if (targetLayer && forbiddenDependencies[ownerLayer]?.has(targetLayer)) {
        boundaryViolations.push(`${path.relative(root, file)} -> ${match[1]} (${ownerLayer} must not depend on ${targetLayer})`)
      }
    }
  }
}

if (missing.length || boundaryViolations.length) {
  if (missing.length) console.error(`Missing imports:\n${missing.join('\n')}`)
  if (boundaryViolations.length) console.error(`Architecture boundary violations:\n${boundaryViolations.join('\n')}`)
  process.exit(1)
}
console.log(`source imports and architecture boundaries ok (${files.length} files)`)
