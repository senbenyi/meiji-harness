// 职责：为项目、流水线与合成测试构造已定稿的剧情规划、按集分镜和任务状态。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const job = letter => letter.repeat(32)

export const series = (episodes = 1) => ({ logline: '一封信改变两人的关系', genre: '悬疑', episode_count: episodes, episode_seconds: 10, world: '雨夜旧城',
  characters: [{ id: 'lin', name: '林', appearance: '灰外套', voice: '低沉', personality: '克制', image_prompt: 'adult Chinese man, grey coat' }],
  scenes: [{ id: 'room', name: '公寓', description: '旧厨房' }],
  episodes: Array.from({ length: episodes }, (_, index) => ({ number: index + 1, title: `第${index + 1}集标题`, summary: '一封信', hook: '门外有人' })) })

export const plannedShot = (id, extra = {}) => ({ scene_id: 'room', roles: ['lin'], shot_size: '近景', camera: '固定', action: `动作 ${id}`, duration: 5,
  dialogue: [{ role: 'lin', text: `台词${id}` }], id, ...extra })

export const shot = (id, extra = {}) => ({ id, roles: ['lin'], scene: 'room', shot_size: '近景', camera: '固定', action: `动作 ${id}`, duration: 5,
  dialogue: [{ role: 'lin', text: `台词${id}` }], subtitle: `台词${id}`, prompt: `提示词 台词${id}`, keyframe_prompt: 'a man in a kitchen',
  prompt_finalized: true, take: 0, keyframe_job_id: null, job_id: null, status: 'pending', ...extra })

// 直接写入全部定稿的规划（总览、时间线、分镜、逐镜提示词）。
export function planning(episodes = 1, shotIds = ['s1', 's2']) {
  const version = (value, based_on) => ({ versions: [{ version: 1, value, request: '', based_on, created_at: 1 }], finalized: 1 })
  return { series: version(series(episodes), {}), episodes: Object.fromEntries(Array.from({ length: episodes }, (_, index) => [String(index + 1), {
    timeline: version({ beats: [] }, { series: 1, previous_timeline: index ? 1 : null }),
    storyboard: version({ shots: shotIds.map(id => plannedShot(id)) }, { timeline: 1 }),
    prompts: Object.fromEntries(shotIds.map(id => [id, version({ prompt: `提示词 台词${id}`, keyframe_prompt: 'a man in a kitchen' }, { storyboard: 1 })])),
  }])) }
}

export const anchors = (source = { type: 'job', job_id: job('c') }) => [
  { role: 'lin', kind: 'character', label: '林', description: '灰外套；音色：低沉；性格：克制', image_prompt: 'adult Chinese man, grey coat', image_job_id: source?.job_id || null, source },
  { role: 'scene-room', kind: 'scene', label: '公寓', description: '旧厨房', source: null },
]

// 在已创建的项目目录中写入规划、锚点与各集分镜。
export async function seedProject(root, id, { episodes = 1, shots = ['s1', 's2'], shotExtra = () => ({}), anchorSource } = {}) {
  const directory = join(root, 'projects', id)
  await writeFile(join(directory, 'planning.json'), JSON.stringify(planning(episodes, shots)))
  await writeFile(join(directory, 'anchors.json'), JSON.stringify(anchors(anchorSource)))
  for (let episode = 1; episode <= episodes; episode++) {
    await mkdir(join(directory, 'episodes', String(episode)), { recursive: true })
    await writeFile(join(directory, 'episodes', String(episode), 'storyboard.json'), JSON.stringify([{ title: `第 ${episode} 集`, shots: shots.map(item => shot(item, shotExtra(item, episode))) }]))
  }
}

export async function writeJob(root, id, status) {
  await mkdir(join(root, 'projects', 'jobs', id), { recursive: true })
  await writeFile(join(root, 'projects', 'jobs', id, 'status.json'), JSON.stringify({ job_id: id, ...status }))
}
