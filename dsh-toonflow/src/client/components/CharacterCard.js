export function CharacterCard(h, { character, projectId, mediaUrl, generateButton }) {
  return h('div', { key: character.id, className: 'tf-thumb' },
    character.imagePath
      ? h('img', { className: 'tf-thumb-img', src: mediaUrl(projectId, character.imagePath), alt: character.name })
      : h('div', { className: 'tf-thumb-img' }, '👤'),
    h('div', { className: 'tf-thumb-label' }, character.name),
    character.imagePath ? null : generateButton,
  )
}
