import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runtimeConfig } from '../config.js'
import { sha256File } from '../functions/common/file-hash.js'
import { ModelTaskError } from '../jobs/contracts.js'

const run = promisify(execFile)

// Preserve the character archive in the request; only derived single-view images reach the model.
export async function prepareVideoReferences(plan, directory, signal) {
  const effective = structuredClone(plan), references = new Map()
  for (const shot of effective.shots || []) {
    if (!shot.image_crop) continue
    const source = shot.image_path, crop = shot.image_crop
    const sourceHash = await sha256File(source)
    const key = JSON.stringify([sourceHash, crop.x, crop.y, crop.width, crop.height])
    if (!references.has(key)) {
      const { stdout } = await run(runtimeConfig().FFPROBE_BIN || 'ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', source,
      ], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 })
      const size = JSON.parse(stdout).streams?.[0]
      if (!size || crop.x + crop.width > size.width || crop.y + crop.height > size.height) {
        throw new ModelTaskError('MODEL_INPUT_INVALID', '[MODEL_INPUT_INVALID] image_crop 超出原图边界', 422)
      }
      await mkdir(directory, { recursive: true })
      const path = join(directory, `reference-${references.size}.png`)
      await run(runtimeConfig().FFMPEG_BIN || 'ffmpeg', ['-v', 'error', '-y', '-noautorotate', '-i', source,
        '-vf', `format=rgb24,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`, '-frames:v', '1', path,
      ], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 })
      references.set(key, { source_path: source, source_sha256: sourceHash, crop,
        path, sha256: await sha256File(path) })
    }
    shot.image_path = references.get(key).path
    delete shot.image_crop
  }
  return { effective, references: [...references.values()] }
}
