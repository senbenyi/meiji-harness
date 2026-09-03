/** Verify every relative source/test import still resolves after structural moves. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensions = new Set(['.js', '.mjs', '.ts', '.tsx'])
const files = []

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
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = path.resolve(path.dirname(file), match[1])
      if (!fs.existsSync(target)) missing.push(`${path.relative(root, file)} -> ${match[1]}`)
    }
  }
}

if (missing.length) {
  console.error(missing.join('\n'))
  process.exit(1)
}
console.log(`source imports ok (${files.length} files)`)
