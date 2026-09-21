// 职责：验证字幕只从当前镜头下的对白行生成。
import test from 'node:test'
import assert from 'node:assert/strict'
import { subtitleText } from '../src/server/projects/film.js'

test('subtitles use current dialogue lines and actual durations', () => {
  const shots = [{ lines: [{ text: '林（低声）：你来了。' }, { text: '动作：转身。' }] },
    { lines: [{ text: '林（低声）：我来了。' }] }]
  const text = subtitleText(shots, [3, 5])
  assert.match(text, /你来了。/)
  assert.match(text, /我来了。/)
  assert.doesNotMatch(text, /转身/)
  assert.match(text, /00:00:03,000 --> 00:00:08,000/)
})
