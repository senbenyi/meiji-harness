import { editLinkedCard } from '../../../../shared/library-rules.js'
// 操作：编辑人物文字
import { checkContext } from '../../../runtime/operation-context.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { runNode } from '../../../runtime/step-execution.js'
import { reviewContent } from '../../steps/step-review-edited-content.js'
import { plotPatch } from '../../../../shared/drama-model.js'
import { characterFieldValues, characterLookText } from '../../../../shared/character-facts.js'
import { editSteps } from '../../../../shared/task-plans.js'

// if (operation.action === 'character-text')
export async function opCharacterText(c) {
  let { operation, deps, projects, models, project, trace, note } = c
  const character = project.plot.characters.items.find(item => item.id === operation.itemId)
  if (!character) throw Object.assign(new Error('人物不存在'), { status: 404 })
  const visualKeys = ['nationality', 'name', 'role', 'gender', 'era', 'age', 'height', 'build', 'features']
  const keys = character.presence === 'voice' ? ['name', 'role', 'identity', 'voiceDescription'] : [...visualKeys, 'voiceDescription']
  const current = characterFieldValues(character)
  if (keys.some(key => current[key] !== String(operation.original?.[key] || ''))) throw Object.assign(new Error('人物已更新，请刷新后编辑'), { status: 409 })
  const values = Object.fromEntries(keys.map(key => [key, String(operation.fields?.[key] || '').trim()]))
  if (keys.some(key => values[key].length > 10000 || !values[key] && !(key === 'voiceDescription' && character.presence !== 'voice' || key === 'role' && character.presence === 'voice'))) throw Object.assign(new Error('人物字段不能为空或超过10000字'), { status: 400 })
  values.costume = current.costume
  if (project.plot.characters.items.some(item => item.id !== character.id && item.name === values.name)) throw Object.assign(new Error('人物名称重复'), { status: 400 })
  const look = character.presence === 'voice' || visualKeys.every(key => values[key] === current[key]) ? character.look || '' : characterLookText(values)
  project = await runNode('save', () => projects.save(project.id, currentProject => {
    const linked = editLinkedCard(currentProject, 'characters', character.id, { ...values, figure: '', look }, { newVariant: operation.newVariant })
    const items = linked.plot.characters.items.map(item => item.id === character.id ? { ...item, ...values, figure: '', look } : item)
    const patch = { ...(linked.library ? { library: linked.library } : {}), ...plotPatch(currentProject, { characters: { ...currentProject.plot.characters, items } }) }
    if (values.name === character.name || !currentProject.shots) return patch
    patch.shots = {
      ...currentProject.shots,
      items: currentProject.shots.items.map(shot => ({
        ...shot,
        cast: (shot.cast || []).map(name => name === character.name ? values.name : name),
        storyboard: Array.isArray(shot.storyboard?.content?.characters)
          ? { ...shot.storyboard, content: { ...shot.storyboard.content, characters: shot.storyboard.content.characters.map(name => name === character.name ? values.name : name) } }
          : shot.storyboard,
      })),
    }
    return patch
  }), { target: 'characters' })
  if (deps.deferReview) { note('人物文字已保存，等待复审或人工通过'); return trace }
  const result = await (deps.reviewContent || reviewContent)({ project, stage: '人物文字编辑，仅审人物与大纲一致性，不要求重写大纲或场景卡', text: JSON.stringify(project.plot.characters.items), route: (modelRoutes(await models.read())).story })
  checkContext.getStore().validation = result.failures
  await projects.save(project.id, {}, { final: true })
  note('人物文字已保存并完成自审，图片保留')
  return trace
}

export const operations = {
  'character-text': { label: '编辑人物文字', scope: 'episode', linkedCard: true, agent: false, plan: () => editSteps('characters'), stage: 'episode', run: opCharacterText },
}
