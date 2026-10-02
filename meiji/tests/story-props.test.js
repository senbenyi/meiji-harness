import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture } from './fixtures/story-package.js'
import { reviewPass } from './fixtures/review-result.js'
import { normalizeProps, generateStoryPackage } from '../server/generate/story.js'
import { preserveStoryAssets } from '../server/data/story-package.js'
import { entityCatalog } from '../shared/entity-references.js'

const prop = (name, category, ownerId = 'C01') => ({ name, category, ownerId, description: `${name}的外观`, evidence: `大纲中使用${name}` })
test('props cover five categories, allow no image or no props and reject unknown owners', () => {
 const project = episodeFixture()
 const result = normalizeProps({items: ['clothing','mount','weapon','accessory','prop'].map((type,i) => prop(`道具${i}`,type))},project)
 assert.deepEqual(result.items.map(i=>i.id),['P01','P02','P03','P04','P05'])
 assert.ok(result.items.every(i => !i.image.content))
 project.plot.props=result
 assert.ok(entityCatalog(project).some(e=>e.id==='P01' && e.kind==='clothes'))
 assert.deepEqual(normalizeProps({items:[]},project).items,[])
 assert.throws(()=>normalizeProps({items:[prop('剑','weapon','C99')]},project),/所属ID不存在/)
 assert.throws(()=>normalizeProps({items:[prop('剑','unknown')]},project),/类别错误/)
 assert.throws(()=>normalizeProps({items:[prop('剑','weapon'),prop('剑','weapon')]},project),/名称重复/)
})
test('four-stage pipeline extracts props from latest approved outline and stable character IDs',async()=>{
 const project=episodeFixture(),fixture=storyPackageFixture()
 project.plot.characters.items[0].id='C07'
 fixture.characters.items[0].name='旅人'
 const requests=[],replies=[outlineFixture('NEW_OUTLINE'),reviewPass,JSON.stringify(fixture.characters),reviewPass,JSON.stringify(fixture.scenes),reviewPass,JSON.stringify({items:[prop('长衣','clothing','C07')]}),reviewPass]
 const result=await generateStoryPackage({project,request:async message=>{requests.push(message);return replies.shift()}})
 assert.equal(requests.length,8);assert.equal(result.check.passed,true)
 assert.match(requests[6].user,/NEW_OUTLINE/);assert.match(requests[6].user,/C07/)
 assert.equal(result.props.items[0].ownerId,'C07')
 project.plot.props=result.props;project.plot.props.items[0].id='P09'
 const merged=preserveStoryAssets(project,{...result,props:normalizeProps({items:[prop('长衣','clothing','C07'),prop('马','mount','C07')]}, {...project,plot:{...project.plot,characters:result.characters}})})
 assert.deepEqual(merged.props.items.map(i=>i.id),['P09','P10'])
})

test('character costume alone does not force props absent from outline', () => {
 const p=episodeFixture();p.plot.characters.items[0].costume='灰色外套'
 assert.deepEqual(normalizeProps({items:[]},p).items,[])
})

test('prop generation review and revision isolate invented card details from evidence', async () => {
 const { StoryPropsModel }=await import('../server/prompts/models/story-model.js')
 const p=episodeFixture();p.plot.characters.items[0].costume='凭空绣金斗篷';p.plot.scenes.items[0].look='凭空紫檀茶台'
 const model=new StoryPropsModel({project:p,generationRules:'只提取大纲明确出现的物件'})
 for(const segments of [model.toGenerateSegments(),model.toReviewSegments({content:{items:[]}}),model.toReviseSegments({baseContent:{items:[]},opinion:'核对大纲'})]) {
  const text=JSON.stringify(segments)
  assert.match(text,/旅人进入庭院/);assert.match(text,/C01/);assert.match(text,/唯一事实来源/)
  assert.doesNotMatch(text,/凭空绣金斗篷|凭空紫檀茶台/)
 }
})
