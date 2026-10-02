import { createHash, createHmac } from 'node:crypto'

function hash(value) { return createHash('sha256').update(value).digest('hex') }

export class AuditLog {
  constructor(fileService, options = {}) {
    this.files = fileService
    this.logicalKey = options.logicalKey || 'audit.ndjson'
    this.checkpointKey = options.checkpointKey || null
    this.tail = { seq: 0, hash: '' }
  }

  async load() {
    if (!(await this.files.exists(this.logicalKey))) return this
    const text = await this.files.readText(this.logicalKey)
    const lines = text.trim().split('\n').filter(Boolean)
    const result = verifyAuditLines(lines)
    if (!result.valid) throw new Error(`audit chain invalid at seq ${result.seq}`)
    this.tail = { seq: result.seq, hash: result.hash }
    return this
  }

  async append({ actor, action, target, revision, detail = {} }) {
    const entry = {
      seq: this.tail.seq + 1,
      prevHash: this.tail.hash,
      timestamp: new Date().toISOString(), actor, action, target, revision, detail,
    }
    entry.eventHash = hash(JSON.stringify(entry))
    await this.files.append(this.logicalKey, JSON.stringify(entry) + '\n')
    this.tail = { seq: entry.seq, hash: entry.eventHash }
    return entry
  }

  checkpoint() {
    if (!this.checkpointKey) throw new Error('checkpoint key not configured')
    return {
      seq: this.tail.seq, hash: this.tail.hash,
      signature: createHmac('sha256', this.checkpointKey).update(`${this.tail.seq}:${this.tail.hash}`).digest('hex'),
      createdAt: new Date().toISOString(),
    }
  }
}

export function verifyAuditLines(lines) {
  let previous = ''
  let seq = 0
  for (const line of lines) {
    const entry = JSON.parse(line)
    if (entry.seq !== seq + 1 || entry.prevHash !== previous) return { valid: false, seq: entry.seq, hash: previous }
    const claimed = entry.eventHash
    const copy = { ...entry }
    delete copy.eventHash
    if (hash(JSON.stringify(copy)) !== claimed) return { valid: false, seq: entry.seq, hash: previous }
    seq = entry.seq
    previous = claimed
  }
  return { valid: true, seq, hash: previous }
}
