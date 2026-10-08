import { deleteEpisodeProjectCharacter } from '../../../../shared/character-deletion.js'
import { saveStep } from '../../../../shared/task-plans.js'

export async function opCharacterDelete({operation,projects,project,trace,note}) {
  await projects.save(project.id,current => deleteEpisodeProjectCharacter(current,operation.episodeId,operation.itemId).project)
  note(`已删除剧集人物 ${operation.itemId} 及对应项目角色与关联卡`)
  return trace
}
export const operations = { 'character-delete': {label:'删除人物及项目角色',scope:'project',lock:'project',agent:false,step:saveStep('characters'),stage:'project',run:opCharacterDelete} }
