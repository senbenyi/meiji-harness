import { validateRuntimeCapability } from './validation.js'

export class CapabilityRegistry {
  constructor(entries = []) {
    this.entries = new Map()
    for (const entry of entries) this.register(entry)
  }
  register(entry) {
    const validation = validateRuntimeCapability(entry)
    if (!validation.ok) throw new Error(validation.errors.join('; '))
    this.entries.set(`${entry.capability}:${entry.tier || 'default'}`, structuredClone(entry))
  }
  list() { return [...this.entries.values()].map((entry) => structuredClone(entry)) }
  resolve(capability, tier = 'default') {
    const entry = this.entries.get(`${capability}:${tier}`) || this.entries.get(`${capability}:default`)
    if (!entry || entry.status !== 'runtime_verified') throw new Error(`no runtime_verified workflow for ${capability}/${tier}`)
    return structuredClone(entry)
  }
}
