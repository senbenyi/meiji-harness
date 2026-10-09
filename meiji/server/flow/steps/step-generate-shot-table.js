import { parseJsonValue } from '../../gateway/model-gateway.js'
import { shotModel } from '../../../shared/drama-model.js'
import { buildTablePrompts, buildSingleShotPrompts } from '../../prompts/shot-text-prompts.js'
import { generateStep } from './shared/text-generate.js'

// 本步骤只生成当前资料；任务层决定是否随后审核。
export const promptsForShotTable = (options) => options.shotId ? buildSingleShotPrompts(options) : buildTablePrompts(options)
export function generateShotTable(input) {
  return generateStep({ ...input, message: input.prompts.generation })
}

// JSON 仅用于传输；解析编号、秒数、标题与正文后沿用现有镜头卡片存储。
export function readShotSections(text, offset = 0) {
  const raw = parseJsonValue(text)
  if (!raw || Array.isArray(raw) || Object.keys(raw).length !== 1 || !Array.isArray(raw.shots) || !raw.shots.length) throw new Error('镜头表结果仅允许非空 shots 数组')
  return raw.shots.map((item, index) => {
    const id = `S${String(offset + index + 1).padStart(2, '0')}`
    const keys = ['shotId', 'durationSeconds', 'title', 'content']
    if (!item || Array.isArray(item) || Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key)) || item.shotId !== id
      || typeof item.title !== 'string' || !item.title.trim() || /[\r\n]/.test(item.title)
      || typeof item.content !== 'string' || !item.content.trim()) throw new Error(`${id} 的编号、1–15秒时长、标题或正文不完整`)
    if (!Number.isInteger(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 15) throw new Error(`${id} 的时长 ${JSON.stringify(item.durationSeconds)} 秒无效，必须为 1–15 秒整数；超过 15 秒应按连续行动或完整台词拆成多镜并重新编号，不删除必要剧情。`)
    return shotModel({ id, duration: item.durationSeconds, text: `标题：${item.title.trim()}\n${item.content.trim()}`, cast: [], scene: '', format: 'text' })
  })
}

