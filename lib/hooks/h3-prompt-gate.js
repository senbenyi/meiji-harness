export const H3_PROMPT_GATE = true
export const H3_GATE_MAX_DENIES = Number.POSITIVE_INFINITY

const H3_WORKFLOW_PREFIX = 'minimax-h3-'
const H3_REF2V_SECTIONS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']
const H3_I2V_SECTIONS = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']

export function h3HasSection(prompt, section) {
  return new RegExp(`(^|\\n)\\s*${section}\\s*:`, 'm').test(prompt)
}

export function createH3PromptGate({ videoShapes, getRegistry, resolveManifest }) {
  function makeH3PromptGateListener() {
    return async function h3PromptGateListener(exec, next) {
      try {
        if (!H3_PROMPT_GATE || !exec?.arguments) return next()
        const name = exec.name
        const args = exec.arguments
        let capability = null
        if (name === 'comfy_generate_video') {
          capability = (args.type && videoShapes[args.type]?.capability) || (args.first_frame_node || args.last_frame_node ? 'video.image2video' : 'video.reference2video')
        } else if (name === 'comfy_render' && typeof args.capability === 'string') {
          capability = args.capability
        } else {
          return next()
        }
        if (!capability || !String(capability).startsWith('video.')) return next()
        const prompt = typeof args.prompt === 'string' ? args.prompt : ''
        if (!prompt.trim()) return next()
        let manifest
        try {
          manifest = resolveManifest(getRegistry(), capability, typeof args.workflow === 'string' ? args.workflow : undefined)
        } catch {
          return next()
        }
        if (!manifest || typeof manifest.id !== 'string' || !manifest.id.startsWith(H3_WORKFLOW_PREFIX)) return next()
        const isI2V = capability === 'video.image2video'
        const required = isI2V ? H3_I2V_SECTIONS : H3_REF2V_SECTIONS
        const missing = required.filter((section) => !h3HasSection(prompt, section))
        if (isI2V && !/For the target video|How the reference pictures align/.test(prompt)) missing.unshift('对齐指令（For the target video… / How the reference pictures align…）')
        if (missing.length === 0) return next()
        const hasStructuredField = [...H3_REF2V_SECTIONS, ...H3_I2V_SECTIONS].some((section) => h3HasSection(prompt, section))
        if (!hasStructuredField) return next()
        const expect = isI2V
          ? 'I2VA/FL2VA 三段式（对齐指令 + integrated_multimodal_description + overall_soundscape + non_diegetic_music）'
          : 'Ref2VA 六段式（subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music）'
        return {
          kind: 'deny',
          reason: `H3 结构化 prompt 校验未通过，缺失：${missing.join(' / ')}。请调用 skill 工具加载 h3-prompt-writing，按它的 references/studio-mapping.md 把本镜 prompt 重写为 ${expect} 后重新调用。`,
        }
      } catch {
        return next()
      }
    }
  }

  return { makeH3PromptGateListener }
}
