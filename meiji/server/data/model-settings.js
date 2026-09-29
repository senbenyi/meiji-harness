import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { defaults } from '../../models/model-config.js'

export function modelStore(home) {
  const root = join(home, 'storages', 'meiji')
  const file = join(root, 'models.json')
  return {
    async read() {
      try { return JSON.parse(await readFile(file, 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') return defaults(); throw error }
    },
    async write(value) {
      await mkdir(root, { recursive: true })
      await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
      await rename(file + '.tmp', file)
    },
  }
}
