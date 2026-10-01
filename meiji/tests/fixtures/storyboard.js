export const textShotFixture = () => '【画面与动作】\n0–5秒，旅人在庭院朝北进入，摄影机位于身后。\n\n【声音】\n风声\n\n【配乐】\nN/A'
export function storyboardFixture(instructions = '') {
  const count = Math.max(0, ...[...instructions.matchAll(/<Picture (\d+)>/g)].map(m => Number(m[1])))
  if (!count) return 'integrated_multimodal_description: 0–5秒旅人朝北进入庭院，摄影机位于身后\noverall_soundscape: 风声\nnon_diegetic_music: N/A'
  return `subject_definitions: <Subject 1> 旅人与庭院，参考 ${Array.from({ length: count }, (_, i) => `<Picture ${i + 1}>`).join('、')}\nsummary: 朝北进入庭院\nretention_analysis: 保留身份与环境，不复制图片姿态\ndetailed_description: 0–5秒 <Subject 1> 旅人在庭院朝北进入，摄影机位于身后\noverall_soundscape: 风声\nnon_diegetic_music: N/A`
}
