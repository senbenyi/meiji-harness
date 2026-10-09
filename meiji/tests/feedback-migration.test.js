import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateProject } from '../scripts/migrate-model.js'
import { targetNode } from '../server/models/data/drama-model.js'
test('one-time migration moves legacy feedback into owning nodes',()=>{
 const p=migrateProject({id:'p',summary:'摘要',episodes:[{id:'e',summary:'剧情',outline:'大纲',outlineSelfCheck:{passed:false,reasons:['结尾缺失']},shots:{items:[{id:'S01',text:'内容',secondsSelfCheck:{passed:false,reasons:['朝向']}}]}}]})
 assert.deepEqual(p.episodes[0].plot.outline.check.failures,['结尾缺失']);assert.deepEqual(targetNode(p.episodes[0],'seconds:S01').check.failures,['朝向']);assert.equal('feedback' in p.episodes[0],false)
})
test('same shot IDs in different episodes retain independent reviews',()=>{
 const p=migrateProject({id:'p',summary:'摘要',episodes:['甲','乙'].map((text,i)=>({id:String(i),summary:text,shots:{items:[{id:'S01',text}]},feedback:{'shot:S01':{check:{passed:false,failures:[text]},review:{text,history:[]}}}}))})
 assert.equal(targetNode(p.episodes[0],'shot:S01').review.text,'甲');assert.equal(targetNode(p.episodes[1],'shot:S01').review.text,'乙')
})
