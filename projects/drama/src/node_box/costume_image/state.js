import { characterGroups, groupOutput } from '../group_setting/state.js'

export function imageTargets(project, characterId, costumeId) {
  return project.character_extraction.characters.filter(row => !characterId || row.id === characterId).flatMap(character =>
    (character.costumes.length ? character.costumes : [null]).filter(costume => costumeId === undefined || (costume?.id ?? null) === costumeId)
      .map(costume => ({ character, costume, groups: characterGroups(groupOutput(project).groups, character, costume), image: project.character_extraction.assets.find(row => row.character_id === character.id)?.costume_images.find(row => row.costume_id === (costume?.id ?? null)) })))
}
