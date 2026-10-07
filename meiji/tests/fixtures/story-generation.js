// 任务：剧集剧情（大纲 → 角色 → 场景；道具不由 AI 提取）
import { runTextNodes } from '../../server/flow/tasks/text-workflow.js'
import { parseJsonValue } from '../../server/gateway/model-gateway.js'
import { checkContext } from '../../server/runtime/operation-context.js'
import { modelRoutes } from '../../models/model-config.js'
import { buildStoryPrompts } from '../../server/prompts/story-prompts.js'
import { normalizeCharacters, normalizeScenes } from '../../shared/story-content.js'
import { normalizeOutline } from '../../shared/story-outline.js'
import { preserveStoryAssets } from '../../shared/preserve-story-assets.js'
import { replaceFrom } from '../../shared/project-rules.js'
import { canGenerate } from '../../shared/generation-gates.js'

export async function generateStoryPackage({ route, project, signal, fetchImpl, request, persist }) {
  const options = { route, project, signal, fetchImpl, request }
  const ctx = checkContext.getStore()
  const pending = () => ({ passed: null, failures: [] })
  const result = { outline: null, characters: { ...project.plot.characters, check: pending(), stale: true },
    scenes: { ...project.plot.scenes, check: pending(), stale: true }, checks: { outline: pending(), characters: pending(), scenes: pending() }, check: pending() }
  const save = async (kind, value, check, publish = true) => {
    if (kind === 'outline') result.outline = value
    else {
      const previous = project.plot[kind]?.items || []
      let next = Math.max(0, ...previous.map(item => Number(item.id.slice(1)) || 0))
      const prefix = { characters: 'C', scenes: 'E' }[kind]
      result[kind] = { ...value, items: value.items.map(item => ({ ...item, id: previous.find(old => old.name === item.name)?.id || `${prefix}${String(++next).padStart(2, '0')}` })), check, stale: false }
    }
    result.checks[kind] = check
    result.check = { passed: Object.values(result.checks).every(value => value.passed === true) ? true
      : Object.values(result.checks).some(value => value.passed === false) ? false : null,
      failures: Object.values(result.checks).flatMap(value => value.failures) }
    if (persist && publish) await persist({ ...result, phase: kind })
  }
  for (const kind of ['outline', 'characters', 'scenes']) {
    (signal || ctx?.signal)?.throwIfAborted()
    if (ctx) ctx.target = { ...ctx.originalOperation, action: 'outline', stageKey: kind }
    const input = kind === 'outline' ? project : { ...project, plot: { ...project.plot, outline: { ...project.plot.outline, content: result.outline }, characters: result.characters, scenes: result.scenes } }
    const normalize = text => {
      const raw = parseJsonValue(text)
      if (kind === 'outline') return normalizeOutline(raw)
      if (Object.keys(raw).length !== 1 || !Array.isArray(raw.items)) throw new Error('提取结果仅允许 items 数组')
      return (kind === 'characters' ? normalizeCharacters : normalizeScenes)(raw)
    }
    const generated = await runTextNodes({ target: kind,
      prompts: buildStoryPrompts(input, kind, '', { extraction: kind !== 'outline' }), options,
      check: text => { normalize(text); return [] },
      canPersist: text => { normalize(text); return true }, retainFailedDraft: kind === 'outline', persist: persist && ((text, check) => save(kind, normalize(text), check)) })
    await save(kind, normalize(generated.text), generated.check, false)
    if (!generated.check.passed) break
  }
  if (ctx) { ctx.target = ctx.originalOperation; ctx.validation = result.check.failures }
  return result
}
