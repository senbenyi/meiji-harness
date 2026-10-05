import { node } from '../../../../shared/drama-model.js'
// 操作：修改镜头素材
import { cascade } from '../../../../shared/pipeline-cascade.js'
import { saveStep } from '../../../../shared/task-plans.js'

// if (operation.action === 'shot-assets')
export async function opShotAssets(c) {
  let { operation, projects, project, trace, note } = c
  const shot = project.shots?.items.find(item => item.id === operation.track)
  if (!shot) throw Object.assign(new Error('没有这一镜'), { status: 404 })
  const cast = (project.plot.characters?.items || []).filter(item => operation.characterIds?.includes(item.id)).map(item => item.name)
  const scene = (project.plot.scenes?.items || []).find(item => item.id === operation.sceneId)?.name || ''
  const patch = cascade(project, { type: 'storyboard', track: shot.id }).patch
  await projects.save(project.id, { ...patch, shots: { ...patch.shots, items: patch.shots.items.map(item => item.id === shot.id ? { ...item, cast, scene, reference_images: operation.referenceIds || [], storyboard: node(`storyboard:${shot.id}`) } : item) } }, { final: true })
  note(`${shot.id} 素材关联已保存，请重新生成文本分镜`)
  return trace
}

export const operations = {
  'shot-assets': { label: '修改镜头素材', scope: 'shot', agent: false, step: saveStep('shots'), stage: 'episode', run: opShotAssets },
}
