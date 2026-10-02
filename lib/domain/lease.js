import { hostname } from 'node:os'

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

export class ProjectLease {
  constructor(fileService, projectId, options = {}) {
    this.files = fileService
    this.projectId = projectId
    this.ownerPid = options.ownerPid || process.pid
    this.ownerHost = options.ownerHost || hostname()
    this.ownerProfile = options.ownerProfile || 'web'
    this.leaseVersion = 1
    this.logicalKey = `leases/${projectId}.json`
  }

  value() {
    const timestamp = new Date().toISOString()
    return {
      ownerPid: this.ownerPid, ownerHost: this.ownerHost, ownerProfile: this.ownerProfile,
      startedAt: this.startedAt || timestamp, heartbeatAt: timestamp, leaseVersion: this.leaseVersion,
    }
  }

  async acquire() {
    this.startedAt = new Date().toISOString()
    try {
      await this.files.createExclusive(this.logicalKey, JSON.stringify(this.value()))
      return { writable: true, lease: this.value() }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const current = JSON.parse(await this.files.readText(this.logicalKey))
      const sameHostDead = current.ownerHost === this.ownerHost && !processAlive(current.ownerPid)
      if (!sameHostDead) return { writable: false, lease: current }
      await this.files.moveToTrash(this.logicalKey)
      await this.files.createExclusive(this.logicalKey, JSON.stringify(this.value()))
      return { writable: true, lease: this.value(), recovered: current }
    }
  }

  async heartbeat() { await this.files.replace(this.logicalKey, JSON.stringify(this.value())) }
  async release() {
    try {
      const current = JSON.parse(await this.files.readText(this.logicalKey))
      if (current.ownerPid === this.ownerPid && current.ownerHost === this.ownerHost) await this.files.remove(this.logicalKey)
    } catch {}
  }
}
