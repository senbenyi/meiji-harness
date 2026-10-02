import { validateWorkflowBindings } from './workflow-bindings.js'

export function runtimeFingerprint({ endpoint, objectInfoHash, manifestHash, modelHash }) {
  return [endpoint, objectInfoHash, manifestHash, modelHash].map((value) => String(value || '')).join(':')
}

export function validateRuntimeCapability(capability) {
  const errors = []
  if (!capability?.capability) errors.push('capability required')
  if (!['configured', 'manifest_verified', 'runtime_verified'].includes(capability?.status)) errors.push('invalid verification status')
  if (capability?.status === 'runtime_verified' && (!capability.verifiedAt || !capability.hash)) errors.push('runtime_verified requires verifiedAt and hash')
  if (capability?.bindings) {
    errors.push(...validateWorkflowBindings(capability.bindings).errors)
    if (capability.status !== 'configured' && capability.bindingStatus !== 'confirmed') errors.push('verified capability requires confirmed bindings')
  }
  return { ok: errors.length === 0, errors }
}
