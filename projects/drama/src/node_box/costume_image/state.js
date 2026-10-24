import { digest, characterGroups, groupOutput } from '../group_setting/state.js'
import { nodeRules } from '../../node_runtime/node_state.js'

export function imageTargets(project, characterId, costumeId) {
  return project.character_extraction.characters.filter(row => !characterId || row.id === characterId).flatMap(character =>
    (character.costumes.length ? character.costumes : [null]).filter(costume => costumeId === undefined || (costume?.id ?? null) === costumeId)
      .map(costume => ({ character, costume, groups: characterGroups(groupOutput(project).groups, character, costume), image: project.character_extraction.assets.find(row => row.character_id === character.id)?.costume_images.find(row => row.costume_id === (costume?.id ?? null)) })))
}
export const imageFingerprint = (project, target) => digest({ character: target.character, costume: target.costume, groups: target.groups,
  aspect_ratio: '3:4', reference_image: target.image.reference_image,
  rules: nodeRules(target.image.node_state) })

