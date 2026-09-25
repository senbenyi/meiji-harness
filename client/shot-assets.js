import { element } from './dom.js'

export function shotAssetsEditor(project, shot, actions) {
  const box = element('details', '', 'shot-card')
  box.append(element('summary', '本镜角色与场景关联'))
  box.append(element('p', '选择实际出场角色、场景及使用的服装道具。保存会清空本镜文本分镜及视频，再生成时固定图片顺序。', 'meta'))
  const people = []
  const parts = []
  for (const person of project.characters?.items || []) {
    const label = element('label', person.name)
    const input = element('input')
    input.type = 'checkbox'
    input.checked = (shot.cast || []).includes(person.name)
    label.prepend(input)
    box.append(label)
    people.push({ id: person.id, input })
    for (const slot of ['clothes', 'props', 'hairstyles']) for (const part of person[slot] || []) {
      if (!part.imageUrl && !part.localPath) continue
      const key = `${person.name}/${slot}/${part.id}`
      const label = element('label', `${person.name} / ${part.name || part.id}`)
      const input = element('input')
      input.type = 'checkbox'
      input.checked = (shot.reference_images || []).includes(key)
      label.prepend(input)
      box.append(label)
      parts.push({ key, input })
    }
  }
  const scene = element('select')
  scene.setAttribute('aria-label', '本镜场景')
  const empty = element('option', '不关联场景图片')
  empty.value = ''
  scene.append(empty)
  for (const item of project.scenes?.items || []) {
    const option = element('option', item.name)
    option.value = item.id
    option.selected = item.name === shot.scene
    scene.append(option)
  }
  const save = element('button', '保存关联')
  save.type = 'button'
  save.disabled = Boolean(project.activity)
  save.onclick = async () => {
    save.disabled = true
    try {
      await actions.perform(project, 'shot-assets', { track: shot.id, characterIds: people.filter(p => p.input.checked).map(p => p.id), sceneId: scene.value, referenceIds: parts.filter(p => p.input.checked).map(p => p.key) })
    } catch (error) { actions.fail(error); save.disabled = false }
  }
  box.append(scene, save)
  return box
}
