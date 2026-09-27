import test from 'node:test'
import assert from 'node:assert/strict'
import { videoPromptText } from '../client/video-prompt-text.js'
import { h3PromptText } from '../server/generate/film.js'
test('UI and video submission share the same prompt serialization',()=>{
 for(const prompt of [null,'  正文  ',{text:'  正文  '},{integrated:'动作',soundscape:'风声',music:'N/A'}]) assert.equal(videoPromptText(prompt),h3PromptText(prompt))
 assert.equal(videoPromptText(null),'')
 assert.equal(videoPromptText({text:' 中文 '}),'中文')
 assert.match(videoPromptText({integrated:'动作',soundscape:'风声',music:'N/A'}),/overall_soundscape: 风声/)
})
