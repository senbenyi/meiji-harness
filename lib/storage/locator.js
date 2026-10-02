import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export async function resolveFileRoot({ configuredRoot, hostRoot } = {}) {
  const candidate = configuredRoot || hostRoot
  if (!candidate) throw new Error('Studio File Service root is not configured by the host or user')
  if (!isAbsolute(candidate)) throw new Error('Studio File Service root must be an absolute path')
  try {
    return { root: await realpath(resolve(candidate)), source: configuredRoot ? 'config' : 'host' }
  } catch (error) {
    throw new Error(`Studio File Service root is unavailable: ${candidate}`, { cause: error })
  }
}
