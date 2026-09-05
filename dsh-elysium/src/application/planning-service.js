import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { ElysiumError } from '../infrastructure/persistence/store.js'
import { DIRECTOR_PROFILE } from './director-profile.js'

const ANCHORS_PER_CHAPTER = 6
const CHAPTER_SECONDS = 20
const CHAPTERS_PER_CALL = 5

function fail(code, message, status = 422) {
  throw new ElysiumError(code, message, status)
}

function extractJson(raw) {
  const clean = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch { /* try the first complete-looking object */ }
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)) } catch { /* reported below */ }
  }
  fail('PLANNER_OUTPUT_INVALID', 'Qwen3.8 返回的规划不是有效 JSON，请重新规划')
}

function normalizeScenes(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.scenes) || value.scenes.length === 0) {
    fail('PLANNER_OUTPUT_INVALID', 'Qwen3.8 未返回 scenes 数组')
  }
  return value.scenes.map((scene, index) => {
    const id = `scene-${String(index + 1).padStart(2, '0')}`
    const summary = String(scene.summary || '').trim()
    if (!summary) fail('PLANNER_OUTPUT_INVALID', `${id} 缺少剧情摘要`)
    return {
      id,
      title: String(scene.title || `第 ${index + 1} 场`).trim(),
      summary,
      characters: Array.isArray(scene.characters) ? scene.characters.map(item => String(item).trim()).filter(Boolean) : [],
      location: String(scene.location || '').trim(),
      timeOfDay: String(scene.timeOfDay || '').trim(),
      dialogueCount: Math.max(0, Number(scene.dialogueCount) || 0),
      dialogueChars: Math.max(0, Number(scene.dialogueChars) || 0),
      emotionStart: String(scene.emotionStart || '').trim(),
      emotionEnd: String(scene.emotionEnd || '').trim(),
      emotionIntensity: Math.min(10, Math.max(0, Number(scene.emotionIntensity) || 0)),
      notes: scene.notes && typeof scene.notes === 'object' ? { ...scene.notes } : {},
      ...(String(scene.transitionToNext || '').trim() ? { transitionToNext: String(scene.transitionToNext).trim() } : {}),
    }
  })
}

function normalizeResult(value, body, chapterCount, scenes) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.chapters)) {
    fail('PLANNER_OUTPUT_INVALID', 'Qwen3.8 未返回 chapters 数组')
  }
  if (value.chapters.length !== chapterCount) {
    fail('PLANNER_OUTPUT_INVALID', `Qwen3.8 应返回 ${chapterCount} 章，实际返回 ${value.chapters.length} 章`)
  }
  const chapters = value.chapters.map((chapter, chapterIndex) => {
    if (!Array.isArray(chapter.anchors) || chapter.anchors.length !== ANCHORS_PER_CHAPTER) {
      fail('PLANNER_OUTPUT_INVALID', `第 ${chapterIndex + 1} 章必须包含 ${ANCHORS_PER_CHAPTER} 个画面锚点`)
    }
    const chapterId = `chapter-${String(chapterIndex + 1).padStart(2, '0')}`
    const sceneIds = Array.isArray(chapter.sceneIds) ? chapter.sceneIds.map(item => String(item)).filter(id => scenes.some(scene => scene.id === id)) : []
    const soundPrompt = String(chapter.soundPrompt || '').trim()
    if (!sceneIds.length) fail('PLANNER_OUTPUT_INVALID', `${chapterId} 缺少有效 sceneIds，无法验证剧情覆盖`)
    if (!soundPrompt) fail('PLANNER_OUTPUT_INVALID', `${chapterId} 缺少 soundPrompt，无法生成完整声音`)
    return {
      id: chapterId,
      order: chapterIndex + 1,
      title: String(chapter.title || `第 ${chapterIndex + 1} 章`).trim(),
      summary: String(chapter.summary || '').trim(),
      sceneIds,
      soundPrompt,
      anchors: chapter.anchors.map((anchor, anchorIndex) => ({
        id: `${chapterId}-anchor-${String(anchorIndex + 1).padStart(2, '0')}`,
        order: anchorIndex + 1,
        role: anchorIndex === 0 ? 'start' : 'continuation',
        imagePrompt: String(anchor.imagePrompt || '').trim(),
        motionPrompt: String(anchor.motionPrompt || '').trim(),
      })),
    }
  })
  const script = {
    schemaVersion: 'elysium-script-2',
    source: 'producer-agent',
    synopsis: String(value.synopsis || body.sourceText).trim(),
    scenes,
  }
  const castPrompt = String(value.castPrompt || body.castPrompt || '').trim()
    || '根据故事中的全部成年角色生成定妆设定表：每名角色分开站立，中性背景，正面全身，清晰面部、发型、体态和服装细节，不要叙事场景。'
  return {
    plan: { schemaVersion: 'elysium-plan-2', episodeId: body.episodeId, source: 'producer-agent', chapters },
    script,
    assets: [
      { id: 'cast-main', type: 'character', name: '角色定妆表', prompt: castPrompt, status: 'prompt_ready' },
      ...(body.stylePrompt ? [{ id: 'scene-style', type: 'scene', name: '统一场景风格', prompt: body.stylePrompt, status: 'prompt_ready' }] : []),
    ],
  }
}

function sceneBreakdownPrompt(body, profile) {
  return `/no_think
你是短剧导演。第一阶段只忠实拆分故事，不创作新剧情，也不设计镜头。

只输出一个 JSON 对象：
{"synopsis":"忠实梗概","scenes":[{"title":"场名","summary":"本场完整剧情","characters":["角色"],"location":"地点","timeOfDay":"时段","dialogueCount":0,"dialogueChars":0,"emotionStart":"起始情绪","emotionEnd":"结束情绪","emotionIntensity":0,"notes":{"emotionalBeat":"情感砸点","consistencyAnchor":"角色服装道具连续性","spatial":"人物位置朝向与距离","ambientSound":"具体环境音源","pitfall":"易错点"},"transitionToNext":"仅必要时填写具体过渡"}]}

规则：场次覆盖全部故事且顺序不变；台词条数和字数如实统计；情绪强度为 ${profile.pacing.emotionScale}，相邻场景情绪落差超过 ${profile.pacing.maxAdjacentEmotionDelta} 时在 pitfall 说明剧本依据；环境音只写可听见的声源，不写配乐；仅在必要时使用 ${profile.transitions.preferred.join('、')}，不需要过渡时省略 transitionToNext；禁止 ${profile.transitions.avoid.join('、')}。

故事：
${body.sourceText}`
}

function plannerPrompt(body, scenes, chapterCount, chapterOffset, totalChapters, continuity, profile) {
  const first = chapterOffset + 1
  const last = chapterOffset + chapterCount
  return `/no_think
你是短剧导演和分镜规划师。请把故事规划为可直接用于长视频生成的 JSON。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown，不要解释。
2. 整集共 ${totalChapters} 章；本次只输出全片第 ${first} 至 ${last} 章，chapters 必须正好 ${chapterCount} 章；每章必须正好 ${ANCHORS_PER_CHAPTER} 个 anchors。
3. 每章第一个 anchor 定义人物一致性首帧；后五个 anchor 只定义 SVI2Pro 连续动作段，不单独生成图片。
4. chapters 必须忠实覆盖下方 scenes，sceneIds 标明来源场景；不得添加 scenes 没有的剧情、人物或道具。
5. 第一个 imagePrompt 是实际首帧提示词；后续 imagePrompt 只描述对应动作段开始时的可见状态，严禁复制整篇故事或写占位描述。
6. 每个 motionPrompt 从首帧出发，描述人物动作、情绪推进和克制运镜；优先 ${profile.camera.motionPreference}，禁止 ${profile.camera.forbiddenMotions.join('、')}；人物换位或转向必须写出衔接动作。
7. 相邻锚点必须有明确叙事推进；章节之间必须衔接上一章结尾的时间、地点、服装、道具和人物状态。
8. 每章 soundPrompt 用英文描述本章可见动作对应的环境声和拟音；不得要求对白、旁白、配音或音乐。
9. 输出画幅为 ${body.aspectRatio === '16:9' ? '16:9 横屏' : '9:16 竖屏'}；不要写字幕、水印、帧率或与该画幅冲突的技术参数。
10. castPrompt 必须是角色定妆设定表提示：所有主要成年角色分开站立、中性背景、正面全身，固定外貌与服装，不要叙事场景。

JSON 结构：
{"synopsis":"一句话梗概","castPrompt":"角色定妆表提示","chapters":[{"title":"章节名","summary":"本章发生的具体事件","sceneIds":["scene-01"],"soundPrompt":"English environmental sound and Foley prompt","anchors":[{"imagePrompt":"具体首帧画面","motionPrompt":"具体动作与运镜"}]}]}

目标时长：${body.targetDurationSec} 秒
画面风格：${body.stylePrompt || `${profile.style.genre}，${profile.style.visualTone}，${profile.style.lighting}`}
人物补充：${body.castPrompt || '从故事中识别全部主要成年角色'}
已审核场景拆解（唯一剧情来源）：
${JSON.stringify(scenes)}
${continuity ? `上一批最后状态：${continuity}\n本批第一章必须从这个状态自然接续。` : ''}`
}

function chapterCountRepairPrompt(raw, expected) {
  return `/no_think
你上一版 JSON 的 chapters 数量错误。请只修正数量并重新输出完整 JSON：chapters 必须正好 ${expected} 章，每章仍必须正好 ${ANCHORS_PER_CHAPTER} 个 anchors，并忠实覆盖原有剧情。不要解释，不要 Markdown。

上一版 JSON：
${JSON.stringify(raw)}`
}

export function createPlannerService(ctx, config = {}) {
  async function plan(body) {
    const provider = String(config.planner?.provider || 'qwen38-local')
    const model = String(config.planner?.model || 'qwen3.8-27b-video-prompt')
    const llm = ctx.llm || ctx.get?.('llm')
    if (!llm?.stream) fail('PLANNER_UNAVAILABLE', 'Qwen3.8 规划服务未加载', 424)
    async function requestJson(prompt) {
      const message = createUserMessage({
        source: { kind: 'plugin', plugin: '@dsh-external/dsh-elysium' },
        content: [{ type: 'text', text: prompt }],
      })
      let output = ''
      let reasoning = ''
      for await (const chunk of llm.stream({
        provider,
        model,
        messages: [message],
        temperature: 0.25,
        maxTokens: Number(config.planner?.maxTokens || 4096),
      })) {
        if (chunk.type === 'text-delta') output += chunk.text
        if (chunk.type === 'reasoning-delta') reasoning += chunk.text
        if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
          fail('PLANNER_FAILED', chunk.reason.failure?.message || 'Qwen3.8 规划失败')
        }
      }
      const raw = output.trim() ? output : reasoning
      if (!raw.trim()) fail('PLANNER_EMPTY', 'Qwen3.8 没有返回规划')
      return extractJson(raw)
    }
    // 导演可以覆盖全局方法论参数；创新项目入口通过 body.directorProfile 传入合并结果。
    const profile = body.directorProfile && typeof body.directorProfile === 'object'
      ? body.directorProfile
      : DIRECTOR_PROFILE
    const breakdown = await requestJson(sceneBreakdownPrompt(body, profile))
    const scenes = normalizeScenes(breakdown)
    const chapterCount = Math.max(1, Math.ceil(Number(body.targetDurationSec ?? 10) / CHAPTER_SECONDS))
    const chapters = []
    let synopsis = ''
    let castPrompt = ''
    let continuity = ''
    for (let offset = 0; offset < chapterCount; offset += CHAPTERS_PER_CALL) {
      const batchSize = Math.min(CHAPTERS_PER_CALL, chapterCount - offset)
      let batch = await requestJson(plannerPrompt(body, scenes, batchSize, offset, chapterCount, continuity, profile))
      if (!Array.isArray(batch?.chapters) || batch.chapters.length !== batchSize) {
        batch = await requestJson(chapterCountRepairPrompt(batch, batchSize))
      }
      if (!Array.isArray(batch?.chapters) || batch.chapters.length !== batchSize) {
        fail('PLANNER_OUTPUT_INVALID', `Qwen3.8 本批应返回 ${batchSize} 章，实际返回 ${batch?.chapters?.length ?? 0} 章`)
      }
      synopsis ||= String(batch.synopsis || '')
      castPrompt ||= String(batch.castPrompt || '')
      chapters.push(...batch.chapters)
      continuity = String(batch.chapters.at(-1)?.summary || '')
    }
    return normalizeResult({ synopsis: synopsis || breakdown.synopsis, castPrompt, chapters }, body, chapterCount, scenes)
  }

  return { plan }
}
