export function videoPromptText(prompt) {
  if (!prompt) return ''
  if (typeof prompt === 'string') return prompt.trim()
  const text = String(prompt?.text || '').trim()
  if (text) return text
  const integrated = String(prompt?.integrated || '').trim()
  const soundscape = String(prompt?.soundscape || '').trim()
  const music = String(prompt?.music || '').trim()
  return [
    `integrated_multimodal_description: ${integrated}`,
    '',
    `overall_soundscape: ${soundscape}`,
    '',
    `non_diegetic_music: ${music}`,
  ].join('\n')
}

