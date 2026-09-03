/** Regenerate the embedded ComfyUI official-node fallback from a live server. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = (process.argv[2] || 'http://127.0.0.1:8189').replace(/\/$/, '')
const stats = await (await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(10000) })).json()
const version = stats?.system?.comfyui_version || 'unknown'
const info = await (await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(120000) })).json()

const official = []
let customCount = 0
for (const [name, node] of Object.entries(info)) {
  const moduleName = String(node?.python_module || '')
  if (moduleName.startsWith('custom_nodes')) customCount += 1
  else official.push(name)
}
official.sort((a, b) => a.localeCompare(b))

const catalog = {
  source: `${baseUrl} (ComfyUI ${version})`,
  generated_at: new Date().toISOString(),
  rule: 'python_module not starting with "custom_nodes." counts as official',
  official,
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destinations = [
  path.join(root, 'src', 'factory', 'server', 'infrastructure', 'comfyui', 'official-nodes.json'),
  path.join(root, 'templates', 'comfyui', 'official-nodes.json'),
]
for (const destination of destinations) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, `${JSON.stringify(catalog, null, 1)}\n`, 'utf8')
}
console.log(`official: ${official.length} | custom: ${customCount}`)
