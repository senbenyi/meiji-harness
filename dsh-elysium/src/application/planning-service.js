import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { ElysiumError } from '../infrastructure/persistence/store.js'

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

function normalizeResult(value, body, chapterCount) {
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
    return {
      id: chapterId,
      order: chapterIndex + 1,
      title: String(chapter.title || `第 ${chapterIndex + 1} 章`).trim(),
      summary: String(chapter.summary || '').trim(),
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
    scenes: chapters.map((chapter, index) => ({
      id: `scene-${String(index + 1).padStart(2, '0')}`,
      title: chapter.title,
      summary: chapter.summary,
    })),
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

function plannerPrompt(body, chapterCount, chapterOffset, totalChapters, continuity) {
  const first = chapterOffset + 1
  const last = chapterOffset + chapterCount
  return `/no_think
你是短剧导演和分镜规划师。请把故事规划为可直接用于长视频生成的 JSON。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown，不要解释。
2. 整集共 ${totalChapters} 章；本次只输出全片第 ${first} 至 ${last} 章，chapters 必须正好 ${chapterCount} 章；每章必须正好 ${ANCHORS_PER_CHAPTER} 个 anchors。
3. 每章第一个锚点是独立文生图起始帧；后五个是连续关键帧。
4. 每个 imagePrompt 只描述该画面可见的主体、动作、场景、构图、光线和连续状态。严禁复制整篇故事，严禁用“第几个画面”等占位描述。
5. 每个 motionPrompt 描述从当前帧到下一状态的主体动作和镜头运动，不能使用空泛重复句。
6. 相邻锚点必须有明确叙事推进；章节之间必须衔接上一章结尾的时间、地点、服装、道具和人物状态。
7. 输出画幅为 ${body.aspectRatio === '16:9' ? '16:9 横屏' : '9:16 竖屏'}；不要写字幕、水印、帧率或与该画幅冲突的技术参数。
8. castPrompt 必须是角色定妆设定表提示：所有主要成年角色分开站立、中性背景、正面全身，固定外貌与服装，不要叙事场景。

JSON 结构：
{"synopsis":"一句话梗概","castPrompt":"角色定妆表提示","chapters":[{"title":"章节名","summary":"本章发生的具体事件","anchors":[{"imagePrompt":"具体画面","motionPrompt":"具体动作与运镜"}]}]}

目标时长：${body.targetDurationSec} 秒
画面风格：${body.stylePrompt || '写实电影感，保持人物与场景连续'}
人物补充：${body.castPrompt || '从故事中识别全部主要成年角色'}
故事：
${body.sourceText}
${continuity ? `上一批最后状态：${continuity}\n本批第一章必须从这个状态自然接续。` : ''}`
}

export function createPlannerService(ctx, config = {}) {
  const provider = String(config.planner?.provider || 'qwen38-local')
  const model = String(config.planner?.model || 'qwen3.8-27b-video-prompt')

  async function plan(body) {
    const llm = ctx.llm || ctx.get?.('llm')
    if (!llm?.stream) fail('PLANNER_UNAVAILABLE', 'Qwen3.8 规划服务未加载', 424)
    const chapterCount = Math.max(1, Math.ceil(Number(body.targetDurationSec || 60) / CHAPTER_SECONDS))
    const chapters = []
    let synopsis = ''
    let castPrompt = ''
    let continuity = ''
    for (let offset = 0; offset < chapterCount; offset += CHAPTERS_PER_CALL) {
      const batchSize = Math.min(CHAPTERS_PER_CALL, chapterCount - offset)
      const message = createUserMessage({
        source: { kind: 'plugin', plugin: '@dsh-external/dsh-elysium' },
        content: [{ type: 'text', text: plannerPrompt(body, batchSize, offset, chapterCount, continuity) }],
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
      const batch = extractJson(raw)
      if (!Array.isArray(batch?.chapters) || batch.chapters.length !== batchSize) {
        fail('PLANNER_OUTPUT_INVALID', `Qwen3.8 本批应返回 ${batchSize} 章，实际返回 ${batch?.chapters?.length ?? 0} 章`)
      }
      synopsis ||= String(batch.synopsis || '')
      castPrompt ||= String(batch.castPrompt || '')
      chapters.push(...batch.chapters)
      continuity = String(batch.chapters.at(-1)?.summary || '')
    }
    return normalizeResult({ synopsis, castPrompt, chapters }, body, chapterCount)
  }

  return { plan }
}
