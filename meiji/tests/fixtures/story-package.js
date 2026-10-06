import { outlineFields } from '../../shared/story-outline.js'
export function storyPackageFixture(seconds = 10) {
  return {
    outline: outlineFixture(`（${seconds}秒）旅人在庭院等待回应。`),
    characters: { items: [{ name: '旅人', appearance: '方脸短发的高大成年男子', identity: '本集旅人的独立身体', look: '国籍：中国\n姓名：旅人\n身份：旅人\n性别：男\n年代：现代\n年龄：30岁\n服装：灰色外套\n身高：180cm\n体型：高大\n面相：方脸短发', clothes: [], props: [], hairstyles: [] }] },
    props: { items: [{name:'旅人灰色外套',category:'clothing',ownerId:'C01',description:'灰色外套',evidence:'人物服装为灰色外套'}] },
    scenes: { items: [{ name: '庭院', landmark: '北侧拱门', light: '西侧月光', space: '中央小径通向北侧拱门', look: '开阔石庭院的中央小径通往完整北侧拱门' }] },
  }
}

export function outlineFixture(content = '旅人在庭院等待回应。', language = 'zh-CN') {
  return Object.fromEntries(outlineFields.map(field => [field, content]))
}

export const outlineResponse = (...args) => JSON.stringify(outlineFixture(...args))

// 剧情请求属于哪一类资料：人物与场景并行执行，测试不能依赖请求先后顺序。
export function storyKind(message) {
  const task = String(message.user || '').split('【本次任务】')[1]?.split('【')[0] || ''
  return /人物/.test(task) ? 'characters' : /场景/.test(task) ? 'scenes' : /道具/.test(task) ? 'props' : 'outline'
}

// 按资料类别应答的剧情请求；reply(kind, message, phase) 返回文本即覆盖默认应答，phase 为 generate 或 review。
export function storyRequest(fixture = storyPackageFixture(), reply = () => undefined) {
  return async message => {
    const kind = storyKind(message), phase = message.skill === 'review' ? 'review' : 'generate'
    const custom = await reply(kind, message, phase)
    if (custom !== undefined) return custom
    return phase === 'review' ? JSON.stringify({ passed: true, issues: [] }) : JSON.stringify(fixture[kind])
  }
}
