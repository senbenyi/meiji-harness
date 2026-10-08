import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setupModel,episodeFixture} from './fixtures/model.js'
import {useWorkspaces} from './fixtures/host.js'
import {createRunService} from '../server/flow/runs/run-service.js'
import {executeRunStep} from '../server/flow/shared/task-executor.js'
import {linkStore} from '../server/data/workspace-links.js'
import {createLibraryEntry} from '../shared/library-rules.js'
import {resolveStoryboardProject} from '../shared/storyboard-characters.js'
import {planRun} from '../shared/run-planner.js'
import {setContent} from '../shared/drama-model.js'
import {compileVideoPrompt} from '../server/prompts/video-prompt-renderer.js'
import {submitVideo} from '../server/flow/steps/step-submit-video.js'
import {submitH3} from '../server/flow/steps/shared/video-submit.js'
import {savePicture} from '../server/data/image-storage.js'
import {runGoalLabel} from '../shared/run-view.js'
import {stepLabel,stepKindLabels} from '../shared/run-names.js'
import {StepKinds} from '../shared/run-model.js'

function named(p){for(const shot of p.shots.items){const c=shot.seconds.content;c.version=2;c.participants=[{name:'旅人',presence:'visible'}];for(const b of c.beats)for(const key of ['action','camera','space','sound','endState'])b[key]=b[key].replace(/【([^|]+)\|[^】]+】/g,'$1')}}
const session='session-11111111-1111-4111-8111-111111111111'
for(const source of ['current','library','missing'])test(`真实纯提示词Run使用${source}资料，规划及运行时模型/生图/视频请求均为零`,async t=>{
 const e=await setupModel(t);useWorkspaces(t);await linkStore(e.home).selectProject(session,e.id,e.store)
 await e.store.save(e.id,root=>{const p=root.episodes[0];named(p);p.plot.characters.secondsSource=null;p.plot.characters.check.passed=null;return root})
 if(source!=='current')await e.store.save(e.id,root=>{const p=root.episodes[0];if(source==='library')createLibraryEntry(root,'characters',{...p.plot.characters.items[0],name:'餐馆老板',aliases:['旅人'],voiceDescription:'低沉男声，普通话'});p.plot.characters.items=[];return root})
 const before=await e.read(),events=[]
 const service=createRunService({home:e.home,execute:async(run,step,deps)=>{events.push(step.kind);return executeRunStep(run,step,deps)},deps:{request:()=>assert.fail('禁止模型调用'),submitAssetImage:()=>assert.fail('禁止生图'),submitH3:()=>assert.fail('禁止视频')}});t.after(()=>service.dispose())
 const preview=await service.plan({projectId:e.id,episodeId:e.episodeId,goal:{to:'film',parts:'storyboard',mode:'regenerate',scope:{tracks:['S01']}}},session)
 assert.deepEqual(preview.run.steps.map(step=>step.kind),['storyboard'])
 await service.confirm(e.id,preview.run.id,session,{confirmDelete:true});await service.drain()
 const run=await service.get(e.id,preview.run.id,session),after=await e.read()
 assert.deepEqual(events,['storyboard']);assert.deepEqual(after.plot.characters.items,before.plot.characters.items);assert.deepEqual(after.plot.outline.content,before.plot.outline.content);assert.deepEqual(after.library,before.library)
 if(source==='missing'){assert.equal(run.status,'failed');assert.match(run.failure.message,/S01.*旅人.*缺少人物资料/);assert.deepEqual(after.shots.items[0].storyboard.content,before.shots.items[0].storyboard.content)}
 else {assert.equal(run.status,'completed',JSON.stringify(run.failure));assert.match(after.shots.items[0].storyboard.content.prompt.text,source==='library'?/餐馆老板/:/旅人/);assert.equal(run.steps[0].prompts?.length||0,0);assert.equal(run.steps[0].responses?.length||0,0);assert.ok(run.steps[0].attempts.some(item=>item.label==='匹配参与角色与既有资料'))}
})

test('纯提示词整集/单镜/重新编排不插入角色、图片及缺图前置；仅视频与尾帧也不自动准备角色',()=>{
 const p=episodeFixture();named(p)
 for(const parts of ['storyboard','video','tail'])for(const mode of ['generate','regenerate']){
  const plan=planRun(p,{to:'film',parts,mode})
  assert.ok(!plan.steps.some(step=>step.target==='characters'||step.kind==='image'||step.target==='images:film-characters'))
  if(parts==='storyboard'){assert.deepEqual(plan.steps.map(step=>step.kind),['storyboard','storyboard']);assert.ok(!plan.prereq.some(item=>item.goal.to==='images'))}
 }
})

test('角色解析拒绝缺清单和重名歧义，库读取不修改上游',()=>{
 const p=episodeFixture();named(p);const s=p.shots.items[0],before=structuredClone(p)
 assert.notEqual(resolveStoryboardProject(p,s),p);assert.deepEqual(p,before)
 p.plot.characters.items.push({...p.plot.characters.items[0],id:'C02'})
 assert.throws(()=>resolveStoryboardProject(p,s),/S01.*旅人.*多个人物/)
 delete s.seconds.content.participants
 assert.throws(()=>resolveStoryboardProject(p,s,{requireParticipants:true}),/缺少participants/)
})

test('实际视频HTTP请求按Picture顺序传PNG/JPEG/WebP和尾帧Base64；缺图时不提交',async t=>{
 const e=await setupModel(t),p=await e.read(),bytes=[Buffer.from('png-reference'),Buffer.from('jpeg-reference'),Buffer.from('webp-reference')],images=[]
 for(const [i,mime] of ['image/png','image/jpeg','image/webp'].entries()){
  const picture=await savePicture(e.home,bytes[i],mime,'characters','角色'+i)
  images.push({...picture,id:'C'+i,entityId:'C'+i,kind:'character',label:'角色'+i,url:picture.localPath,subjectIds:[i+1]})
 }
 const directory=join(e.home,'storages','meiji','projects',e.id,'films',e.episodeId);await mkdir(directory,{recursive:true});const tail=Buffer.from('tail-reference');await writeFile(join(directory,'previous-last.png'),tail)
 images.push({kind:'tailFrame',label:'前镜尾帧',sourceVideoFile:'previous.mp4',sourceShotId:'S00',url:'/preview-only',subjectIds:[]})
 const item={id:'S01',duration:5,video:'reference',referenceSnapshot:images,prompt:{text:'subject_definitions:\n'+images.slice(0,3).map((_,i)=>`<Subject ${i+1}>：角色${i}，参考<Picture ${i+1}>`).join('\n')+'\n<Picture 4>：上一镜尾帧，仅为连续性参考'+'\nsummary:\n人物行走\nretention_analysis:\n保留身份\ndetailed_description:\n[Shot 1] 0–5s <Subject 1>与<Subject 2>、<Subject 3>行走\noverall_soundscape:\n脚步声\nnon_diegetic_music:\nN/A'}}
 let requests=0
 const deps={submitH3:input=>submitH3({...input,fetchImpl:async(_url,options)=>{
  requests++;const body=JSON.parse(options.body);assert.equal(body.reference_images.length,4)
  for(const [i,data] of body.reference_images.entries()){assert.match(data,/^data:image\/(png|jpeg|webp);base64,/);assert.deepEqual(Buffer.from(data.split(',')[1],'base64'),[...bytes,tail][i])}
  assert.deepEqual(body.reference_images.map(data=>data.split(';')[0]),['data:image/png','data:image/jpeg','data:image/webp','data:image/png'])
  return Response.json({id:'video-test',seconds:'5',status:'queued'})
 }})}
 await submitVideo({project:p,item,track:'S01',home:e.home,route:{baseUrl:'https://gateway.test',apiKey:'test',model:'elysium-video'},deps,size:'9:16',images})
 assert.equal(requests,1)
 const missing=images.map((image,i)=>i===3?{...image,sourceVideoFile:'missing.mp4'}:image)
 await assert.rejects(submitVideo({project:p,item:{...item,referenceSnapshot:missing},track:'S01',home:e.home,route:{},deps,size:'9:16',images:missing}),/参考图不存在/)
 assert.equal(requests,1)
})

test('所有步骤种类都有中文业务名，任务标题区分产物/模式/范围',()=>{
 for(const kind of StepKinds){assert.ok(stepKindLabels[kind],kind);assert.doesNotMatch(stepLabel({kind,target:'storyboard:S03'}),/expand|image|storyboard|undefined/)}
 for(const [goal,expected] of [
  [{to:'film',parts:'storyboard',mode:'regenerate',scope:{tracks:['S03']}},'重新编排S03分镜提示词'],
  [{to:'film',parts:'video',scope:{tracks:['S03']}},'生成S03视频'],
  [{to:'film',parts:'tail',scope:{tracks:['S03']}},'提取S03尾帧'],
  [{to:'story',scope:{only:'characters'}},'生成人物资料'],[{to:'story',scope:{only:'scenes'}},'生成场景资料'],
  [{to:'images',scope:{itemIds:['C01']}},'生成C01人物图片'],[{to:'seconds',mode:'review',scope:{tracks:['S01']}},'审核S01每秒指令'],
  [{to:'assemble'},'拼接成片'],[{to:'script-sync'},'回写剧本'],[{to:'script-revise'},'生成剧本修改方案']]) assert.ok(runGoalLabel({goal}).includes(expected),JSON.stringify(goal))
 assert.equal(stepLabel({kind:'expand',target:'images:film-characters'}),'安排人物图片步骤')
 assert.equal(stepLabel({kind:'storyboard',target:'storyboard:S03'}),'编排分镜提示词 · S03')
})
