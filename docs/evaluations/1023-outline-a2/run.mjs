import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { modelClient } from '@agent-modules/http-client'
import { createModelSettings } from '../../../projects/drama/src/settings/model-settings.js'
import { composeNodePrompt } from '../../../projects/drama/src/node_runtime/node_prompt_composer.js'
import { parseNodeOutput } from '../../../projects/drama/src/node_runtime/output_response_parser.js'
import { select } from './selection.mjs'

const dir = dirname(fileURLToPath(import.meta.url)), old = resolve(dir, '../1023-outline-ab')
const json = async p => JSON.parse(await readFile(p, 'utf8'))
const save = async (p, d) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(d, null, 2) + '\n') }
const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex')
const event = async x => { const row = { at: new Date().toISOString(), ...x }; await appendFile(resolve(dir, 'events.jsonl'), JSON.stringify(row) + '\n'); process.stdout.write(JSON.stringify(row) + '\n') }
const config = await createModelSettings(resolve(process.env.HOME, '.dsh/storages/drama')).read()
const rules = Object.fromEntries(await Promise.all(['story', 'shot', 'video', 'definitions'].map(async n => [n, await json(resolve(dir, `rules/A2-${n}.json`))])))
const oldVideo = await json(resolve(dir, 'rules/A1-shared-video-prompt-v2.json'))
const videoGoal = '仅为指定完整节拍生成文生视频提示词，不输出评语。'
const originalOutlineGoal = '将本次完整工作剧本改编为最终故事大纲，增强人物可信度、情节连贯与观赏性；保持故事核心方向、主要人物身份关系与结局，保留原稿明确列出的创作核心。无需服从原稿时间预算，剧情中实际发生的期限仍须保留。完整返回全部故事，不在本次调用中审核或修订。'
const originalShotGoal = '把全部已确认大纲转成完整镜头表。覆盖每段正文、全部锚点及定稿对白，不改编剧情；无人物/场景资产，关联ID可为空。正常选择镜头数量和节拍，不设总时长、镜头数或输出简写要求。完整输出，不在本次调用审核或修订。'
const cases = [1, 2, 3].flatMap(round => ['moon', 'wusong', 'complex'].map(key => ({ key, round })))

async function invoke(base, prompt) {
  try { const raw = await readFile(resolve(base, 'response.txt'), 'utf8'); await event({ event: 'cache_reused', base }); return raw } catch (e) { if (e.code !== 'ENOENT') throw e }
  await save(resolve(base, 'prompt.json'), prompt)
  const started = Date.now(), requestId = 'outline-a2-' + randomUUID(), transport = []
  await event({ event: 'request', base, requestId })
  try {
    const raw = await modelClient.complete({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.text.model, messages: prompt.messages, requestId,
      signal: AbortSignal.timeout(900000), timeoutMs: 900000, retryDelays: [],
      record: async t => transport.push({ ok: t.ok, status: t.response?.status, usage: t.response?.body?.usage ?? t.response?.data?.usage ?? null, error: t.error?.code ?? null }) })
    await writeFile(resolve(base, 'response.txt'), raw)
    await save(resolve(base, 'call.json'), { requestId, elapsedMs: Date.now() - started, inputChars: JSON.stringify(prompt.messages).length, outputChars: raw.length, promptHash: hash(prompt.messages), transport })
    await event({ event: 'returned', base, elapsedMs: Date.now() - started, outputChars: raw.length })
    return raw
  } catch (e) {
    await save(resolve(base, 'call.json'), { requestId, elapsedMs: Date.now() - started, transport, error: { code: e.code ?? null, message: String(e.message).replace(/https?:\/\/\S+/g, '[endpoint]') } })
    throw new Error('模型请求失败：' + base)
  }
}
async function generate(base, nodeType, nodeRules, input, goal) {
  const prompt = composeNodePrompt({ nodeType, action: 'generate', rules: nodeRules, input, goal, definition: rules.definitions })
  const raw = await invoke(base, prompt), parsed = parseNodeOutput(nodeType, 'generate', raw, { definition: rules.definitions })
  await save(resolve(base, 'parsed.json'), parsed)
  return parsed
}
function metrics(outline, shots) {
  const segments = new Map(outline.segments.map(s => [s.id, s])), seen = new Set(), refs = new Set(), issues = []
  for (const [i, s] of shots.shots.entries()) {
    if (seen.has(s.id)) issues.push({ kind: 'duplicate_shot_id', id: s.id }); seen.add(s.id)
    const seg = segments.get(s.story_segment_id)
    if (!seg) issues.push({ kind: 'invalid_segment', id: s.id })
    for (const a of s.key_anchor_ids) { refs.add(a); if (!seg?.key_anchors.some(x => x.id === a)) issues.push({ kind: 'invalid_anchor', shot: s.id, anchor: a }) }
    if (s.previous_shot_connection === 'opening' && i !== 0) issues.push({ kind: 'repeated_opening', id: s.id })
  }
  return { shotCount: shots.shots.length, beatCount: shots.shots.reduce((n, s) => n + s.beats.length, 0),
    missingSegments: outline.segments.filter(s => !shots.shots.some(x => x.story_segment_id === s.id)).map(s => s.id),
    missingAnchors: outline.segments.flatMap(s => s.key_anchors.map(a => a.id)).filter(a => !refs.has(a)), issues }
}
function validateClips(output, ids) {
  const actual = output.items.map(i => i.clip_id)
  if (ids.length !== actual.length || new Set(actual).size !== actual.length || ids.some(x => !actual.includes(x)) || output.items.some(i => !i.text_to_video)) throw new Error('分片集合或模式不符')
}
async function pipeline({ key, round }) {
  const base = resolve(dir, `results/${key}/round-${round}/A2`), status = { key, round, stages: {} }
  await mkdir(base, { recursive: true })
  let stage = 'outline'
  try {
    const script = await readFile(resolve(dir, `inputs/${key}.txt`), 'utf8')
    const outline = await generate(resolve(base, 'outline'), 'story_segments', rules.story,
      { basic_info: { actual_script: script, summary: '', estimated_duration_seconds: 0 }, current_outline: { segments: [] }, instruction: originalOutlineGoal, output_language: config.output_language }, originalOutlineGoal)
    if (!outline.segments.length) throw new Error('空大纲')
    const ids = outline.segments.map(s => s.id), anchors = outline.segments.flatMap(s => s.key_anchors.map(a => a.id))
    if (new Set(ids).size !== ids.length || new Set(anchors).size !== anchors.length) throw new Error('重复段或锚点ID')
    status.stages.outline = 'passed'; stage = 'shot'
    const shots = await generate(resolve(base, 'shot'), 'shot_design', rules.shot,
      { story_segments: outline, character_extraction: { characters: [] }, scene_extraction: { scenes: [] }, current_shots: { shots: [] }, output_language: config.output_language }, originalShotGoal)
    if (!shots.shots.length) throw new Error('空镜头表')
    status.stages.shot = 'passed'; status.metrics = metrics(outline, shots); stage = 'final'
    const selection = select(shots, key, outline)
    await save(resolve(base, 'final/selection.json'), selection)
    if (!selection.selected.length) throw new Error('无符合主题和时长的样本')
    const input = { output_language: config.output_language, clips: selection.selected.map(x => ({ clip: x.clip, shot: x.shot, prior_beats_context: x.prior_beats_context, context_note: 'prior_beats_context仅提供本镜此前累积状态，不在当前分片重复动作和对白' })) }
    const output = await generate(resolve(base, 'final'), 'video_prompt', rules.video, input, videoGoal)
    validateClips(output, selection.selected.map(x => x.clip.id))
    status.stages.final = 'passed'; status.status = 'completed'
  } catch (e) { status.status = 'failed'; status.failedStage = stage; status.error = String(e.message).slice(0, 350) }
  await save(resolve(base, 'result.json'), status); await event({ event: 'pipeline_finished', ...status })
}
async function controls() {
  for (const { key, round } of cases) {
    const source = resolve(old, `results/${key}/round-${round}/A/final-v2`)
    let original
    try { original = await json(resolve(source, 'prompt.json')) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    const selection = await json(resolve(source, 'selection.json'))
    // Render exactly the recorded old final input, do not derive newer states or change clips.
    const user = original.messages.find(m => m.role === 'user').content
    const marker = '# 本次资料\n'
    const index = user.indexOf(marker)
    if (index < 0) throw new Error('旧提示词资料分隔符变化，须人工检查')
    const input = JSON.parse(user.slice(index + marker.length).trim())
    const base = resolve(dir, `controls/${key}/round-${round}`)
    await save(resolve(base, 'source.json'), { path: source, inputHash: hash(input), selection })
    for (const version of ((round + ['moon', 'wusong', 'complex'].indexOf(key)) % 2 ? ['A1', 'A2'] : ['A2', 'A1'])) {
      const result = { key, round, version, inputHash: hash(input), source, status: 'failed' }
      try {
        const output = await generate(resolve(base, version), 'video_prompt', version === 'A1' ? oldVideo : rules.video, input, videoGoal)
        validateClips(output, selection.selected.map(x => x.clip.id)); result.status = 'completed'
      } catch (e) { result.error = String(e.message).slice(0, 350) }
      await save(resolve(base, version, 'result.json'), result); await event({ event: 'control_finished', ...result })
    }
  }
}
const mode = process.argv[2] ?? 'full'
if (mode === 'full') {
  await save(resolve(dir, 'run-settings.json'), { createdAt: new Date().toISOString(), model: config.text.model, output_language: config.output_language, rounds: 3, fullConcurrency: 2, controlConcurrency: 1, maximumConcurrentRequests: 3, timeoutMs: 900000, sampling: '模型服务默认，无seed/temperature；无内容重采样和调用重试', upstreamGoals: '与历史A完全一致', finalGoal: videoGoal, hashes: Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, hash(v)])), comparison: '历史A全链路 + 同输入新旧最终规则控制组，非同时随机化全链路对照' })
  let next = 0
  await Promise.all([0, 1].map(async () => { while (next < cases.length) await pipeline(cases[next++]) }))
} else if (mode === 'controls') await controls()
else throw new Error('未知模式')
await event({ event: 'finished', mode })
