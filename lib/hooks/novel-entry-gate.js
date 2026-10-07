const INTERNAL_NOVEL_TOOLS = new Set([
  'studio_project_create',
  'studio_source_import',
  'studio_source_read',
  'studio_novel_orchestrate',
  'studio_content_analysis_submit',
  'studio_asset_design_submit',
  'studio_asset_extraction_submit',
  'studio_shot_prompts_submit',
  'studio_episode_plan_submit',
  'studio_episode_draft_submit',
  'studio_episode_script_submit',
  'studio_batch_generate',
])

/** Keep root Agents on the single novel entrypoint; workflow children remain scoped by child-policy. */
export function makeNovelEntryGateListener() {
  return async function novelEntryGateListener(exec, next) {
    const parentSession = String(exec?.agent?.session?.header?.parentSession || '')
    if (parentSession || !INTERNAL_NOVEL_TOOLS.has(exec?.name)) return next()
    return {
      kind: 'deny',
      reason: `${exec.name} 是短剧 Workflow 内部工具。根 Agent 必须只调用 studio_novel_create；局部范围用 scope、episodeCount 和 maxShotsPerEpisode 表达。`,
    }
  }
}

export { INTERNAL_NOVEL_TOOLS }
