import {projectNodeStates} from '../src/shared/production/production_stages.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProjectDocument} from '../src/drama_runtime/drama_document.js'
import {migrateStorySegments} from '../scripts/migrate-story-segments.js'

test('定稿迁移先预览、备份，保留剧本和历史，仅去除现行来源关联且可重复执行',async t=>{
 const root=await mkdtemp(join(tmpdir(),'drama-story-migrate-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const directory=join(root,'projects','p_story');await mkdir(join(directory,'artifacts'),{recursive:true})
 const document=createProjectDocument({id:'p_story',name:'已有剧本'})
 document.story_segments.segments=[{id:'s1',sequence:1,revision:2,title:'第一段',body_ref:'artifacts/body.txt',continuity_ref:null,source_chapter_ids:['old'],source_spans:[{source_revision_id:'original',start:0,end:10}]}]
 projectNodeStates(document).story_segments.checkpoint={task_id:'task_old',unit_id:'unit_old',unit_ref:'artifacts/unit.json',candidate_ref:'artifacts/candidate.json',state:'saved',product_revision:0}
 const original=JSON.stringify(document);await writeFile(join(directory,'project.json'),original);await writeFile(join(directory,'artifacts/body.txt'),'完整改编剧本文字');await writeFile(join(directory,'artifacts/history.json'),original)
 assert.equal((await migrateStorySegments(root)).changed,1);assert.equal(await readFile(join(directory,'project.json'),'utf8'),original)
 const result=await migrateStorySegments(root,{apply:true}),after=JSON.parse(await readFile(join(directory,'project.json'),'utf8'))
 assert.equal(await readFile(join(result.backup,'p_story.json'),'utf8'),original)
 assert.equal(after.story_segments.segments[0].revision,2);assert.equal(after.story_segments.segments[0].body_ref,'artifacts/body.txt');assert.equal(projectNodeStates(after).story_segments.checkpoint,null)
 assert.equal('source_chapter_ids' in after.story_segments.segments[0],false);assert.equal('source_spans' in after.story_segments.segments[0],false)
 assert.equal(await readFile(join(directory,'artifacts/body.txt'),'utf8'),'完整改编剧本文字');assert.equal(await readFile(join(directory,'artifacts/history.json'),'utf8'),original)
 assert.equal((await migrateStorySegments(root,{apply:true})).changed,0)
})
