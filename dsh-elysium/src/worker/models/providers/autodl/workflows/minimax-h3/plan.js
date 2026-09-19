// 职责：校验 AutoDL 当前五种 H3 模式和 main 分支导演计划，两类输入严格互斥。
import { mediaReference } from '../../../../protocols/comfyui/media-reference.js'
import { validatePlan as validateProtocolPlan } from '../../../../protocols/comfyui/plan.js'
import { ModelTaskError } from '../../../../../tasks/jobs/errors.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', `[MODEL_INPUT_INVALID] ${message}`, 422)

export function isDirectorPlan(args) {
  return args?.duration !== undefined || args?.shots !== undefined || args?.prompts !== undefined || args?.video_paths !== undefined || args?.image_prompt !== undefined
}

export function toDirectorPlan(args) {
  if (isDirectorPlan(args) || !['t2va', 'i2va'].includes(args?.mode)) return null
  const duration = !args.quality && args.profile === 'preview' ? 3 : Math.max(1, Math.round(args.duration_seconds ?? 5))
  return { duration, prompts: [args.prompt], ...(args.quality ? { quality: args.quality } : {}), ...(args.mode === 'i2va' ? { image_path: args.first_frame } : {}) }
}

export async function validateDirectorPlan(args) {
  const allowed = new Set(['duration', 'shots', 'prompts', 'image_path', 'image_prompt', 'video_paths', 'seed', 'quality'])
  if (Object.keys(args).some(key => !allowed.has(key))) throw invalid('包含未支持的工作流参数')
  if (!Number.isInteger(args.duration) || args.duration < 1) throw invalid('duration 必须为正整数总秒数')
  if (args.quality !== undefined && !['fast', 'regular', 'high'].includes(args.quality)) throw invalid('短剧创作质量无效')
  if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2 ** 32 - 1)) throw invalid('seed 必须为 uint32')
  if (args.shots !== undefined) {
    if (['prompts', 'image_path', 'image_prompt', 'video_paths'].some(k => k in args)) throw invalid('shots 不能与旧参数混用；素材必须绑定到对应镜头')
    return validateShots(args.shots, args.duration)
  }
  if (args.duration > 15 && !args.video_paths && !args.image_path) throw invalid('短剧开拍前必须准备 image_path，不接受临时生成参考图')
  const clips = args.video_paths
  if (clips !== undefined) {
    if (!Array.isArray(clips) || !clips.length || args.prompts !== undefined || args.image_prompt !== undefined || args.image_path !== undefined) throw invalid('已有视频列表不能为空，且不能与生成输入混用')
  } else {
    if (!Array.isArray(args.prompts) || !args.prompts.length || args.prompts.some(p => typeof p !== 'string' || !p.trim())) throw invalid('提供非空分镜提示词列表')
    if (args.duration <= 15 ? args.prompts.length !== 1 : args.prompts.length < 2 || args.duration < args.prompts.length || args.duration > args.prompts.length * 15) throw invalid('多镜头请使用 shots 明确各镜时长；不得缩短总时长或删减镜头以绕过校验')
    if (args.image_prompt !== undefined && (typeof args.image_prompt !== 'string' || !args.image_prompt.trim())) throw invalid('image_prompt 不能为空')
    if ('image_path' in args && 'image_prompt' in args) throw invalid('image_path 与 image_prompt 二选一')
  }
  for (const value of [...(clips || []), ...('image_path' in args ? [args.image_path] : [])]) {
    try { mediaReference(value, clips ? ['.mp4'] : ['.png', '.jpg', '.jpeg', '.webp']) } catch (error) { throw invalid(error.message) }
  }
}

export async function validatePlan(args) {
  if (isDirectorPlan(args)) return validateDirectorPlan(args)
  if (args?.quality !== undefined && !['fast', 'regular', 'high'].includes(args.quality)) throw invalid('视频创作质量无效')
  if (!['t2va', 'i2va'].includes(args?.mode)) throw invalid('当前 AutoDL 服务仅开放 t2va、i2va；其他标准模式尚未完成服务器兼容验收')
  if (['preview', 'regular'].includes(args?.profile) && !['t2va', 'i2va'].includes(args.mode)) throw invalid(`${args.profile} 仅支持 t2va、i2va`)
  if (args?.preview_variant !== undefined && (args.profile !== 'preview' || !['default', 'low-resolution'].includes(args.preview_variant))) throw invalid('preview_variant 仅用于 preview，支持 default、low-resolution')
  if (args?.duration_seconds !== undefined && (args.quality === undefined && args.profile !== 'regular' || !Number.isFinite(args.duration_seconds) || args.duration_seconds <= 0)) throw invalid('duration_seconds 必须为大于 0 的有限数值')
  const result = validateProtocolPlan(args)
  if (toDirectorPlan(args).duration > 15) throw invalid('单次视频时长不能超过 15 秒')
  return result
}

async function validateShots(shots, duration) {
  if (!Array.isArray(shots) || !shots.length) throw invalid('shots 必须为非空镜头列表')
  const ids = new Set()
  const mediaTypes = { image_path: ['.png', '.jpg', '.jpeg', '.webp'], video_path: ['.mp4', '.mov', '.webm', '.mkv'], audio_path: ['.wav', '.mp3', '.flac', '.m4a', '.ogg'] }
  for (const [index, shot] of shots.entries()) {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot) || Object.keys(shot).some(k => !['id', 'duration', 'mode', 'prompt', 'seed', 'in_point', 'image_role', ...Object.keys(mediaTypes)].includes(k))) throw invalid('镜头包含未支持的字段')
    if (typeof shot.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(shot.id) || ids.has(shot.id)) throw invalid('镜号须为唯一的 1..48 位字母、数字、下划线或连字符')
    ids.add(shot.id)
    const mode = shot.mode === undefined ? 'independent' : shot.mode
    if (!['independent', 'reference', 'continue', 'reuse'].includes(mode)) throw invalid('镜头 mode 无效')
    if (!Number.isInteger(shot.duration) || shot.duration < 1 || (mode !== 'reuse' && shot.duration > 15)) throw invalid('生成镜头须为 1..15 秒，复用镜头须为正整数秒')
    if ('seed' in shot && (!Number.isInteger(shot.seed) || shot.seed < 0 || shot.seed > 2 ** 32 - 1)) throw invalid('镜头 seed 必须为 uint32')
    const media = Object.keys(mediaTypes).filter(k => k in shot)
    if ('image_role' in shot && (!shot.image_path || !['character-sheet', 'single-view', 'scene'].includes(shot.image_role))) throw invalid('image_role 需要 image_path，且为 character-sheet、single-view 或 scene')
    if (shot.image_role === 'character-sheet') throw invalid('三视图仅作角色档案；开拍前请提供已经确认的单人参考素材')
    if (shots.length > 1 && !['continue', 'reuse'].includes(mode) && !shot.image_path) throw invalid('短剧开拍前必须为每个独立镜头准备 image_path 素材；不会自动生成或裁切参考图')
    if (mode === 'reuse') {
      if (media.length !== 1 || media[0] !== 'video_path' || 'prompt' in shot || 'seed' in shot) throw invalid('reuse 仅接受已有 video_path，不接受提示词或种子')
    } else {
      if (typeof shot.prompt !== 'string' || !shot.prompt.trim()) throw invalid('生成镜头必须提供原始完整 prompt')
      if ('in_point' in shot) throw invalid('in_point 仅用于复用素材剪辑')
      if (mode === 'independent' && media.some(k => k !== 'image_path')) throw invalid('音视频参考请使用 reference')
      if (mode === 'reference' && !media.length) throw invalid('reference 至少需要一项真实参考素材')
      if (mode === 'continue' && (index === 0 || media.length)) throw invalid('continue 必须跟随前镜头，且不能混入其他参考素材')
    }
    if ('in_point' in shot && (typeof shot.in_point !== 'number' || !Number.isFinite(shot.in_point) || shot.in_point < 0)) throw invalid('in_point 必须为非负有限秒数')
    for (const kind of media) {
      try { mediaReference(shot[kind], mediaTypes[kind]) } catch (error) { throw invalid(`${kind}: ${error.message}`) }
    }
  }
  if (shots.reduce((sum, s) => sum + s.duration, 0) !== duration) throw invalid('镜头时长之和必须等于 duration；不得自动缩短或删减镜头')
}
