import test from 'node:test'
import assert from 'node:assert/strict'
import { addEpisode, editEpisode, materialize, overviewPatch, normalizeProject } from '../shared/episode-rules.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { setupModel } from './fixtures/model.js'
import { node } from '../shared/drama-model.js'
test('runtime rejects pre-model projects instead of silently converting',()=>assert.throws(()=>normalizeProject({id:'old',episodes:[]}),/迁移/))
test('new episodes are newest first; changing duration resets only that episode',async t=>{
 const e=await setupModel(t),p=await e.store.read(e.id),next={...p,...addEpisode(p,{summary:'第二集',durationSeconds:12})}
 assert.equal(next.episodes[0].summary.content,'第二集')
 const patch=editEpisode(next,e.episodeId,{durationSeconds:11})
 assert.deepEqual(patch.episodes[0],next.episodes[0]);assert.equal(patch.episodes[1].shots.items.length,0);assert.equal(patch.episodes[1].plot.outline.content,null)
})
test('episode saves remain in the selected episode',async t=>{const e=await setupModel(t),scope=scopeProjects(e.store,e.episodeId);await scope.save(e.id,{pendingImages:{outline:'补充'}});const p=await e.store.read(e.id);assert.equal(p.pendingImages,undefined);assert.equal(p.episodes[0].pendingImages.outline,'补充')})
test('episode context preserves language and project identity',async t=>{const e=await setupModel(t);const p=await e.store.save(e.id,{outputLanguage:'en'});const v=materialize(p,e.episodeId);assert.equal(v.id,p.id);assert.equal(v.episodeId,p.episodes[0].id);assert.equal(v.outputLanguage,'en');assert.equal(v.summary.content,'旅人进入庭院')})
test('overview edits preserve script and update project metadata',async t=>{const e=await setupModel(t),p=await e.store.save(e.id,{script:'剧本'});const patch=overviewPatch(p,{title:'新标题'});assert.equal(patch.script,undefined);assert.equal(p.script,'剧本');assert.equal(patch.summary,undefined);assert.throws(()=>overviewPatch(p,{summary:'新摘要'}),/项目摘要由 AI/);assert.equal(patch.title,'新标题')})
