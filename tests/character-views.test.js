import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeImageData } from '../server/generate/character-views.js'
import { normalizeCharacters } from '../server/generate/story.js'

const look = [
  '国籍：中国',
  '姓名：陈锋',
  '身份：穿越后的吕布',
  '性别：男',
  '年代：三国',
  '年龄：二十八岁',
  '服装：暗色漆甲',
  '身高：一米八二',
  '体型：肩宽',
  '面相：方脸，短黑发',
].join('\n')

test('character cards keep one uploaded photo and no view set', () => {
  const characters = normalizeCharacters({
    items: [{
      name: '陈锋', role: '主角', appearance: '二十八岁', costume: '暗色漆甲', identity: '方脸', look,
      file: { id: 'file_a', url: 'http://gateway/v1/files/file_a/content' },
    }],
  })
  assert.equal(characters.items[0].views, undefined)
  assert.equal(characters.items[0].file, undefined)
  assert.equal(characters.items[0].imageUrl, 'http://gateway/v1/files/file_a/content')
  assert.equal(characters.items[0].features, '方脸，短黑发')
})

test('a view upload accepts a png data uri', () => {
  const png = Buffer.from('front').toString('base64')
  const decoded = decodeImageData(`data:image/png;base64,${png}`)
  assert.equal(decoded.mime, 'image/png')
  assert.equal(decoded.bytes.toString(), 'front')
})
