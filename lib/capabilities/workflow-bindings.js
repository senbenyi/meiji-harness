const SEMANTIC_KEYS = new Set(['positivePrompt', 'negativePrompt', 'width', 'height', 'frames', 'seed', 'referenceImages', 'outputs'])

function targets(value) {
  return Array.isArray(value) ? value : value ? [value] : []
}

export function validateWorkflowBindings(bindings, workflow = null) {
  const errors = []
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return { ok: false, errors: ['bindings must be an object'] }
  for (const [semantic, rawTargets] of Object.entries(bindings)) {
    if (!SEMANTIC_KEYS.has(semantic)) { errors.push(`unknown binding: ${semantic}`); continue }
    for (const target of targets(rawTargets)) {
      const nodeId = String(target?.nodeId ?? target?.node ?? '')
      const input = target?.input ?? target?.field
      if (!nodeId) errors.push(`${semantic} binding nodeId required`)
      if (semantic !== 'outputs' && typeof input !== 'string') errors.push(`${semantic} binding input required`)
      if (semantic === 'outputs' && !target?.mediaType) errors.push('outputs binding mediaType required')
      if (workflow && nodeId && !workflow[nodeId]) errors.push(`${semantic} binding references missing node: ${nodeId}`)
      if (workflow && nodeId && semantic !== 'outputs' && typeof input === 'string' && !(input in (workflow[nodeId]?.inputs || {}))) {
        errors.push(`${semantic} binding references missing input: ${nodeId}.${input}`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

export function deriveWorkflowCapabilities(bindings) {
  const has = (key) => targets(bindings?.[key]).length > 0
  return {
    prompts: has('positivePrompt'),
    negativePrompt: has('negativePrompt'),
    adjustableSize: has('width') && has('height'),
    adjustableFrames: has('frames'),
    adjustableSeed: has('seed'),
    referenceImages: targets(bindings?.referenceImages).length,
    outputTypes: [...new Set(targets(bindings?.outputs).map((target) => target.mediaType).filter(Boolean))],
  }
}
