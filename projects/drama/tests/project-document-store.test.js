import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ProjectDocumentStore} from '../src/drama_runtime/drama_document_store.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'drama-v2-'));const store=new ProjectDocumentStore(root);t.after(async()=>{await store.dispose();await rm(root,{recursive:true,force:true})});return {root,store}}

test('新存储只保存V2文档，10MiB原稿外置且短剧JSON不含正文副本',async t=>{
 const {store,root}=await fixture(t),body='x'.repeat(10*1024*1024),p=await store.create({name:'长稿',original_script:body})
 assert.equal(p.schema_version,2);assert.equal(p.source.revisions[0].character_count,body.length)
 assert.ok((await readFile(join(root,'projects',p.basic_info.id,'project.json'))).length<12000)
 const first=await store.readArtifact(p.basic_info.id,p.source.revisions[0].file_ref,{start:0,end:16000});assert.equal(first.length,16000)
 assert.equal((await store.readArtifact(p.basic_info.id,p.source.revisions[0].file_ref)).length,body.length)
 await assert.rejects(store.readArtifact(p.basic_info.id,p.source.revisions[0].file_ref,{start:0,end:16001}),/最多16000/)
})

test('原稿人工修改创建新版本，旧来源文件及引用保持不变',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'原稿',original_script:'旧正文'})
 const next=await store.replaceSource(p.basic_info.id,'新正文',{expectedRevision:0})
 assert.equal(next.source.revisions.length,2);assert.notEqual(next.source.current_revision_id,p.source.current_revision_id)
 assert.equal((await store.readArtifact(p.basic_info.id,p.source.revisions[0].file_ref)).toString(),'旧正文')
 await assert.rejects(store.replaceSource(p.basic_info.id,'迟到覆盖',{expectedRevision:0}),{code:'EDIT_CONFLICT'})
})

test('各阶段人工产物可持久保存且旧版本写入会被拒绝',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'编辑'})
 const plan={...p.adaptation_plan,goal:'人工调整改编目标'}
 const next=await store.saveProduct(p.basic_info.id,'adaptation_plan',plan,{expectedRevision:0})
 assert.equal((await store.read(p.basic_info.id)).adaptation_plan.goal,plan.goal)
 assert.equal(next.node_states.adaptation_plan.status,'draft')
 await assert.rejects(store.saveProduct(p.basic_info.id,'adaptation_plan',plan,{expectedRevision:0}),{code:'EDIT_CONFLICT'})
})

test('同版本并发编辑只接受一个，不丢失已提交内容',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'并发'})
 const results=await Promise.allSettled(['甲','乙'].map(goal=>store.saveProduct(p.basic_info.id,'adaptation_plan',{...p.adaptation_plan,goal},{expectedRevision:0})))
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected')[0].reason.code,'EDIT_CONFLICT')
})

test('意见编辑也有旧值保护，产物保存不会清除意见',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'意见'})
 await store.saveOpinion(p.basic_info.id,'story_segments','保留原话',{previous:''})
 await store.saveProduct(p.basic_info.id,'story_segments',{segments:[]},{expectedRevision:0})
 assert.equal((await store.read(p.basic_info.id)).node_states.story_segments.opinion,'保留原话')
 await assert.rejects(store.saveOpinion(p.basic_info.id,'story_segments','覆盖',{previous:''}),{code:'EDIT_CONFLICT'})
})

test('文件引用不能越界、穿透符号链接或伪造尚不存在的产物',async t=>{
 const {store,root}=await fixture(t),p=await store.create({name:'边界'})
 await assert.rejects(store.readArtifact(p.basic_info.id,'../project.json'),/引用无效/)
 const outside=join(root,'outside.txt');await writeFile(outside,'outside');const dir=join(store.directory(p.basic_info.id),'artifacts');await mkdir(dir);await symlink(outside,join(dir,'external.txt'))
 await assert.rejects(store.readArtifact(p.basic_info.id,'artifacts/external.txt'),/越界/)
 await assert.rejects(store.saveProduct(p.basic_info.id,'editing',{...p.editing,preview_ref:'artifacts/missing.txt'},{expectedRevision:0}),{code:'ENOENT'})
 assert.equal((await store.read(p.basic_info.id)).document_revision,0)
})

test('不迁移或静默接受旧JSON，禁止覆盖已存在短剧',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'版本'})
 await assert.rejects(store.create({id:p.basic_info.id,name:'覆盖'}),{code:'PROJECT_EXISTS'})
 await writeFile(join(store.directory(p.basic_info.id),'project.json'),JSON.stringify({basic_info:{id:p.basic_info.id}}))
 await assert.rejects(store.read(p.basic_info.id),{code:'UNSUPPORTED_PROJECT_VERSION'})
})

test('编辑资料与新原稿原子提交，冲突/坏原稿不半写，旧来源完整保留',async t=>{
 const {store}=await fixture(t),p=await store.create({name:'联合编辑',original_script:'旧原稿'}),id=p.basic_info.id,{id:unused,...value}=p.basic_info;value.name='新名称'
 await assert.rejects(store.saveBasicInfo(id,value,{expectedRevision:0,source:{text:'   ',original_name:'空稿.txt'}}),/原稿/);assert.deepEqual(await store.read(id),p)
 const next=await store.saveBasicInfo(id,value,{expectedRevision:0,source:{text:'新原稿',original_name:'新稿.txt'}});assert.equal(next.basic_info.name,'新名称');assert.equal(next.node_states.project.product_revision,1);assert.equal(next.source.revisions.length,2);assert.equal((await store.readArtifact(id,p.source.revisions[0].file_ref)).toString(),'旧原稿');assert.equal((await store.readArtifact(id,next.source.revisions[1].file_ref)).toString(),'新原稿')
 await assert.rejects(store.saveBasicInfo(id,{...value,name:'迟到覆盖'},{expectedRevision:0,source:{text:'迟到原稿',original_name:'迟到.txt'}}),{code:'EDIT_CONFLICT'});assert.deepEqual(await store.read(id),next)
 const updated=await store.saveBasicInfo(id,{...value,name:'只改名称'},{expectedRevision:1});assert.deepEqual(updated.source,next.source)
})

test('原著分段直接保存body，拒绝同长改写、遗漏、重复和乱序且失败不半写',async t=>{
 const {store}=await fixture(t),text='甲乙\r\n丙丁😀',p=await store.create({name:'正文校验',original_script:text}),id=p.basic_info.id,sourceId=p.source.current_revision_id,chapters=[{id:'c1',sequence:1,title:'段一',body:'甲乙\r\n'},{id:'c2',sequence:2,title:'段二',body:'丙丁😀'}],value={source_revision_id:sourceId,chapters,facts_ref:null,coverage_ref:null}
 const saved=await store.saveProduct(id,'source_analysis',value,{expectedRevision:0});assert.deepEqual(saved.source_analysis.chapters,chapters)
 for(const broken of [[],chapters.map((c,i)=>({...c,body:i?'丁丙😀':c.body})),chapters.slice(0,1),[...chapters, {...chapters[0],id:'c3',sequence:3}],chapters.map((c,i)=>({...chapters[1-i],sequence:i+1}))])await assert.rejects(store.saveProduct(id,'source_analysis',{...value,chapters:broken},{expectedRevision:1}),/正文|顺序|原稿/)
 assert.deepEqual((await store.read(id)).source_analysis,saved.source_analysis);assert.equal((await store.readArtifact(id,p.source.revisions[0].file_ref)).toString(),text)
})
