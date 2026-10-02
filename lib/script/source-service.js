import { createHash, randomUUID } from 'node:crypto'
import { sourceDocumentLogicalKey } from '../storage/layout.js'

export const MAX_SOURCE_TEXT_BYTES = 20 * 1024 * 1024
export const MAX_SOURCE_CHUNK_CHARS = 32 * 1024

export function normalizeSourceText(value) {
  const text = String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) throw new Error('source text must not be empty')
  if (text.includes('\0')) throw new Error('source text must not contain NUL bytes')
  const bytes = Buffer.byteLength(text)
  if (bytes > MAX_SOURCE_TEXT_BYTES) throw new Error(`source text exceeds ${MAX_SOURCE_TEXT_BYTES} bytes`)
  return text
}

export class SourceTextService {
  constructor({ projectService, fileService }) {
    this.projects = projectService
    this.files = fileService
  }

  async importText({ projectId, title, text, format = 'text', sourceId, commandId = randomUUID() }) {
    if (!['text', 'txt', 'markdown', 'md'].includes(format)) throw new Error(`unsupported source format: ${format}`)
    const normalized = normalizeSourceText(text)
    const project = await this.projects.getProject(projectId)
    if (!sourceId) {
      let sequence = Object.keys(project.sourceDocuments || {}).length + 1
      do { sourceId = `source-${String(sequence++).padStart(3, '0')}` } while (project.sourceDocuments[sourceId])
    }
    const logicalKey = sourceDocumentLogicalKey(projectId, sourceId, title)
    const contentHash = createHash('sha256').update(normalized).digest('hex')
    const existing = project.sourceDocuments[sourceId]
    if (existing) {
      if (existing.contentHash !== contentHash) throw new Error(`source document is immutable and already exists: ${sourceId}`)
      const descriptor = await this.files.describe(existing.logicalKey)
      if (descriptor.contentHash !== existing.contentHash) throw new Error(`source content hash mismatch: ${sourceId}`)
      return this.projects.execute({
        projectId, commandId, expectedRevision: project.revision, type: 'registerSourceDocument',
        payload: {
          sourceId: existing.id, title: existing.title, format: existing.format, logicalKey: existing.logicalKey,
          contentHash: existing.contentHash, bytes: existing.bytes, characters: existing.characters,
        },
        actor: 'source-import',
      })
    }
    const descriptor = await this.files.atomicWrite(logicalKey, normalized)
    try {
      return await this.projects.execute({
        projectId, commandId, expectedRevision: project.revision, type: 'registerSourceDocument',
        payload: {
          sourceId, title: title || sourceId, format: format === 'md' ? 'markdown' : format === 'txt' ? 'text' : format,
          characters: normalized.length, ...descriptor,
        },
        actor: 'source-import',
      })
    } catch (error) {
      const current = await this.projects.getProject(projectId).catch(() => null)
      if (current?.sourceDocuments?.[sourceId]?.contentHash !== descriptor.contentHash) {
        await this.files.remove(logicalKey).catch(() => {})
      }
      throw error
    }
  }

  async readChunk({ projectId, sourceId, cursor = 0, limit = 12000 }) {
    const project = await this.projects.getProject(projectId)
    const source = project.sourceDocuments[sourceId]
    if (!source) throw new Error(`source document not found: ${sourceId}`)
    const start = Number(cursor)
    const size = Number(limit)
    if (!Number.isInteger(start) || start < 0) throw new Error('source cursor must be a non-negative integer')
    if (!Number.isInteger(size) || size < 1 || size > MAX_SOURCE_CHUNK_CHARS) throw new Error(`source limit must be between 1 and ${MAX_SOURCE_CHUNK_CHARS}`)
    const [content, descriptor] = await Promise.all([this.files.readText(source.logicalKey), this.files.describe(source.logicalKey)])
    if (descriptor.contentHash !== source.contentHash) throw new Error(`source content hash mismatch: ${sourceId}`)
    if (start > content.length) throw new Error(`source cursor exceeds document length: ${start}`)
    let end = Math.min(content.length, start + size)
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end -= 1
    return {
      sourceId, contentHash: source.contentHash, start, end, total: content.length,
      text: content.slice(start, end), eof: end >= content.length,
    }
  }
}
