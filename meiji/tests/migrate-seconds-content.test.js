import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { readProjectFile, writeProjectFile, episodeSnapshot } from '../server/data/project-files.js'
import { migrate } from '../scripts/migrate-seconds-content.js'

test('migration backs up, archives old seconds and preserves videos; repeat is a no-op',async t=>{
 const e=await setupModel(t),p=await readProjectFile(e.home,e.id),before=episodeSnapshot(p)
 delete p.episodes[0].plot.props
 const shot=p.episodes[0].shots.items[0]
 shot.seconds.content='旧每秒正文';shot.video.content={file:'keep.mp4'}
 await writeProjectFile(e.home,p,before)
 const out=await migrate(e.home),saved=await readProjectFile(e.home,e.id),s=saved.episodes[0].shots.items[0]
 assert.deepEqual(out.projects,[e.id]);assert.equal(s.seconds.content,null)
 assert.equal(s.seconds.archivedContent,'旧每秒正文');assert.deepEqual(s.video.content,{file:'keep.mp4'});assert.equal(s.video.stale,true)
 assert.deepEqual(saved.episodes[0].plot.props.items,[])
 const backup=join(out.backup,e.id),index=JSON.parse(await readFile(join(backup,'index.json'),'utf8'))
 const original=JSON.parse(await readFile(join(backup,'episodes',index.episodes[0].file),'utf8'))
 assert.equal(original.shots.items[0].seconds.content,'旧每秒正文')
 assert.ok((await readdir(join(backup,'episodes'))).length)
 assert.deepEqual(await migrate(e.home),{backup:null,projects:[]})
})
