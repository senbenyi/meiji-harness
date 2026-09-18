// 职责：校验并持久化全局导演库，首次读取时写入默认导演。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requiredConfig } from '../../utils/config.js'
import { invalidRequest } from '../../http/shared.js'

export const DEFAULT_DIRECTORS = [
  { name: '张艺谋', style: '视觉叙事、色彩象征、历史史诗', works: ['红高粱', '活着', '英雄', '十面埋伏', '悬崖之上'] },
  { name: '王家卫', style: '碎片化叙事、都市情绪、时间与记忆', works: ['阿飞正传', '重庆森林', '花样年华', '2046', '一代宗师'] },
  { name: '陈凯歌', style: '历史人文、命运悲剧、宏大叙事', works: ['黄土地', '孩子王', '霸王别姬', '荆轲刺秦王', '长津湖'] },
  { name: '姜文', style: '黑色幽默、强烈作者表达、荒诞历史', works: ['阳光灿烂的日子', '鬼子来了', '太阳照常升起', '让子弹飞', '邪不压正'] },
  { name: '贾樟柯', style: '现实主义、社会变迁、纪实美学', works: ['小武', '站台', '世界', '三峡好人', '山河故人'] },
]

function directorValue(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 ||
    typeof value.style !== 'string' || !value.style.trim() || value.style.length > 1000) throw invalidRequest('请填写导演名称和风格')
  const works = Array.isArray(value.works) ? value.works.map(String) : typeof value.works === 'string' ? [value.works] : []
  return { name: value.name.trim(), style: value.style.trim(), works }
}

export function createDirectorStore() {
  const root = () => requiredConfig('ELYSIUM_STATE_ROOT')
  const path = () => join(root(), 'directors.json')
  let operations = Promise.resolve()

  function enqueue(action) {
    const operation = operations.then(action)
    operations = operation.catch(() => {})
    return operation
  }

  async function write(value) {
    await mkdir(root(), { recursive: true })
    const temporary = `${path()}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path()) }
    finally { await rm(temporary, { force: true }) }
  }

  async function load() {
    try {
      const value = JSON.parse(await readFile(path(), 'utf8'))
      if (!Array.isArray(value)) throw new Error('导演库格式无效')
      return value.map(directorValue)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const value = DEFAULT_DIRECTORS.map(item => ({ ...item, works: [...item.works] }))
      await write(value)
      return value
    }
  }

  const list = () => enqueue(load)
  const has = name => enqueue(async () => (await load()).some(item => item.name === name))
  const create = value => enqueue(async () => {
    const director = directorValue(value), items = await load()
    if (items.some(item => item.name === director.name)) throw invalidRequest('导演名称已存在')
    await write([...items, director])
    return director
  })
  const update = value => enqueue(async () => {
    const director = directorValue(value), items = await load()
    const index = items.findIndex(item => item.name === director.name)
    if (index < 0) throw invalidRequest('导演不存在')
    items[index] = director
    await write(items)
    return director
  })
  const reorder = names => enqueue(async () => {
    const items = await load()
    if (!Array.isArray(names) || names.length !== items.length || names.some(name => typeof name !== 'string') ||
      new Set(names).size !== items.length || names.some(name => !items.some(item => item.name === name))) throw invalidRequest('导演排序无效')
    const byName = new Map(items.map(item => [item.name, item]))
    const ordered = names.map(name => byName.get(name))
    await write(ordered)
    return ordered
  })
  const remove = async (name, inUse = async () => false) => {
    if (typeof name !== 'string' || !name.trim()) throw invalidRequest('导演名称无效')
    if (await inUse(name)) throw invalidRequest('该导演已被项目使用，不能删除')
    return enqueue(async () => {
      const items = await load(), index = items.findIndex(item => item.name === name)
      if (index < 0) throw invalidRequest('导演不存在')
      await write(items.filter((_, itemIndex) => itemIndex !== index))
      return { deleted: true }
    })
  }

  return { list, has, create, update, reorder, remove }
}
