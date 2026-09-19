// 职责：按版本快照拆分持久化制作资料，项目元数据最后发布快照指针。
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { saveJson, readJson } from '../json.js'
export async function saveProduction(directory, production) {
  const snapshot = randomUUID(), root = join(directory, 'production', 'revisions', snapshot)
  const { story, assets, segments, queue, timeline, exports, ...state } = production
  await Promise.all([saveJson(join(root, 'state.json'), state), saveJson(join(root, 'story.json'), story), saveJson(join(root, 'assets.json'), assets),
    saveJson(join(root, 'queue.json'), queue), saveJson(join(root, 'timeline.json'), timeline), saveJson(join(root, 'exports.json'), exports),
    saveJson(join(root, 'segments', 'index.json'), segments.map(({ id, title, scene_id }) => ({ id, title, scene_id }))),
    ...segments.map(async s => {
      const { shots, inputs, generations, ...segment } = s, path = join(root, 'segments', s.id)
      await Promise.all([saveJson(join(path, 'segment.json'), segment), saveJson(join(path, 'storyboard.json'), shots), saveJson(join(path, 'generations.json'), generations),
        saveJson(join(path, 'h3-inputs', 'index.json'), inputs.map(i => i.id)), ...inputs.map(i => saveJson(join(path, 'h3-inputs', `${i.id}.json`), i))])
    })])
  return snapshot
}
export async function loadProduction(directory, snapshot) {
  if (!/^[a-f0-9-]{36}$/.test(snapshot)) throw new Error('制作快照指针无效')
  const root = join(directory, 'production', 'revisions', snapshot)
  const [state, story, assets, queue, timeline, exports, index] = await Promise.all(['state', 'story', 'assets', 'queue', 'timeline', 'exports', 'segments/index'].map(n => readJson(join(root, `${n}.json`))))
  if (!state || !story || !index) throw new Error('制作快照不完整')
  const segments = await Promise.all(index.map(async ({ id }) => {
    if (!/^segment-[a-zA-Z0-9-]+$/.test(id)) throw new Error('片段 ID 无效')
    const path = join(root, 'segments', id), [segment, shots, generations, inputIds] = await Promise.all(['segment', 'storyboard', 'generations', 'h3-inputs/index'].map(n => readJson(join(path, `${n}.json`))))
    const inputs = await Promise.all(inputIds.map(id => { if (!/^input-[a-f0-9-]+$/.test(id)) throw new Error('输入版本 ID 无效'); return readJson(join(path, 'h3-inputs', `${id}.json`)) }))
    return { ...segment, shots, generations, inputs }
  }))
  return { ...state, story, assets, queue, timeline, exports, segments }
}
