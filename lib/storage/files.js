import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, appendFile, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { storageLayout } from './layout.js'

export class FileService {
  constructor(root) {
    if (!root || !isAbsolute(root)) throw new Error('FileService requires an absolute root')
    this.root = resolve(root)
    this.layout = storageLayout(this.root)
  }

  async initialize() {
    await access(this.root, constants.R_OK | constants.W_OK)
    await Promise.all(Object.entries(this.layout)
      .filter(([key]) => !['root', 'audit'].includes(key))
      .map(([, path]) => mkdir(path, { recursive: true })))
    return this
  }

  resolve(logicalKey) {
    if (!logicalKey || isAbsolute(logicalKey)) throw new Error('logicalKey must be a relative path')
    const absolute = resolve(this.root, logicalKey)
    const rel = relative(this.root, absolute)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes FileService root: ${logicalKey}`)
    return absolute
  }

  async atomicWrite(logicalKey, data) {
    const destination = this.resolve(logicalKey)
    await mkdir(dirname(destination), { recursive: true })
    const temporary = this.resolve(`tmp/${randomUUID()}.part`)
    await writeFile(temporary, data)
    await rename(temporary, destination)
    return this.describe(logicalKey)
  }

  async publishFile(sourcePath, logicalKey) {
    if (!isAbsolute(sourcePath)) throw new Error('sourcePath must be absolute')
    const destination = this.resolve(logicalKey)
    await mkdir(dirname(destination), { recursive: true })
    const temporary = this.resolve(`tmp/${randomUUID()}.part`)
    await copyFile(sourcePath, temporary)
    const sourceInfo = await stat(sourcePath)
    const copiedInfo = await stat(temporary)
    if (sourceInfo.size !== copiedInfo.size) {
      await rm(temporary, { force: true })
      throw new Error(`copied size mismatch for ${logicalKey}`)
    }
    await rename(temporary, destination)
    return this.describe(logicalKey)
  }

  async read(logicalKey) { return readFile(this.resolve(logicalKey)) }
  async readText(logicalKey) { return readFile(this.resolve(logicalKey), 'utf8') }
  async exists(logicalKey) { try { await stat(this.resolve(logicalKey)); return true } catch { return false } }

  async describe(logicalKey) {
    const absolute = this.resolve(logicalKey)
    const [buffer, info] = await Promise.all([readFile(absolute), stat(absolute)])
    return { logicalKey, bytes: info.size, contentHash: createHash('sha256').update(buffer).digest('hex') }
  }

  async moveToTrash(logicalKey) {
    const source = this.resolve(logicalKey)
    const trashKey = `trash/${Date.now()}-${randomUUID()}-${logicalKey.replaceAll('/', '_')}`
    await rename(source, this.resolve(trashKey))
    return trashKey
  }

  async remove(logicalKey) { await rm(this.resolve(logicalKey), { force: true }) }

  async createExclusive(logicalKey, value) {
    const file = this.resolve(logicalKey)
    await mkdir(dirname(file), { recursive: true })
    const handle = await open(file, 'wx')
    try { await handle.writeFile(value) } finally { await handle.close() }
  }

  async replace(logicalKey, value) { return this.atomicWrite(logicalKey, value) }
  async append(logicalKey, value) {
    const file = this.resolve(logicalKey)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, value)
  }
}
