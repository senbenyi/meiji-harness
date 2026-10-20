import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFixture,taskFixture} from './fixtures/project.js';
import {config,renderTaskPrompt} from './fixtures/ai.js';
import {videoSpeechTiming} from '../shared/video-inputs.js';
import {dependencyHash} from '../shared/node-dependencies.js';
import {videoRequest} from '../server/http/video-request.js';
import {videoPayload} from '../server/http/llm-server/params.js';
import {createAiRoutes,composeNodePrompt} from '../server/http/ai-routes.js';
import {createMediaHandler} from '../server/handlers/media-handler.js';
import {dialoguePaceRule} from '../shared/prompt-models/common.js';

const line='搬运不用汽械，便少一层摩擦起火的风险。工程照计划进行。';
const audio='巴比堪画内对白约2–7秒连续发声；车轮与搬运声在对白下持续。';
const textPrompt={integrated_multimodal_description:`[Shot 1] 巴比堪抬眼，平静清楚地说：<d>${line}</d>，随后走向工人。`,overall_soundscape:'车轮声持续。',non_diegetic_music:'N/A'};
const image='data:image/png;base64,aW1hZ2U=';
function fixture(){
 const snapshot=snapshotFixture(),p=snapshot.project,e=p.episodes[0],shot=e.shot_list.shots[0];
 shot.duration_seconds=15;Object.assign(shot.text_to_video_prompt,textPrompt);shot.video_generation_type='文生';
 const beat=structuredClone(shot.seconds_storyboard.storyboard[0]);
 shot.seconds_storyboard.storyboard=[{...beat,time_range:'0–2s',audio:'车轮声',dialogue:[]},{...beat,time_range:'2–8s',audio,dialogue:[{speaker_id:'',speaker_name:'巴比堪',mode:'画内',dialogue_text:line}]},{...beat,time_range:'8–15s',audio:'搬运声',dialogue:[]}];
 return{snapshot,p,e,shot};
}

test('实际媒体handler把遗漏转写的原对白时序和语速目标发送给视频网关，台词只出现一次',async()=>{
 const{snapshot,p,shot}=fixture(),before=structuredClone(shot),calls=[];
 const ai=createAiRoutes({readConfig:async()=>({...config,video:{model:'MiniMax-H3'}}),gateway:{video:async options=>{calls.push(options);return{taskId:'speech-video',url:'https://example.test/video.mp4'};}}});
 const handler=createMediaHandler({media:{},ai});
 const result=await handler({snapshot,task:taskFixture(p,'video',shot.id,{action:'generate'}),step:{kind:'generate'},signal:new AbortController().signal,record:async()=>{}});
 assert.equal(result.content.server_address,'https://example.test/video.mp4');assert.equal(calls.length,1);
 const sent=calls[0];assert.deepEqual(sent.trace.input.speechTiming,videoSpeechTiming(shot));
 assert.ok(sent.prompt.includes(audio));assert.match(sent.prompt,/画面节拍范围：2–8s/);
 assert.ok(sent.prompt.includes(dialoguePaceRule));assert.equal(sent.prompt.split(dialoguePaceRule).length,2);
 assert.equal(sent.prompt.split(`<d>${line}</d>`).length,2);assert.equal(sent.duration,15);
 assert.equal(sent.trace.input.textPrompt.integrated_multimodal_description.includes('2–7秒'),false);
 assert.deepEqual(shot,before);
});

test('文生、首尾帧与已保存多模态编排都附原时序，保持三段、台词和视频时长',()=>{
 const{shot}=fixture(),speechTiming=videoSpeechTiming(shot);
 const base={type:'文生',textPrompt,duration:15,aspectRatio:'16:9'};
 const bindings=[{name:'巴比堪',speaker_tag:'(S1)',costume:'深蓝礼服'}];
 const multi={...base,type:'多模态',referenceImages:[image],referenceBindings:bindings};
 const packed=videoRequest(multi).prompt;
 for(const input of [base,{...base,type:'首尾帧',firstFrame:image},{...multi,packedPrompt:packed}]){
  const original=videoRequest(input),request=videoRequest({...input,speechTiming});
  assert.ok(request.prompt.includes(audio));assert.ok(request.prompt.endsWith(original.prompt));
  assert.equal(request.prompt.split(`<d>${line}</d>`).length,2);
  const payload=videoPayload({model:'MiniMax-H3',...request});assert.equal(payload.duration,15);
  assert.equal(Object.hasOwn(payload,'speed'),false);assert.equal(Object.hasOwn(payload,'speechTiming'),false);
 }
 const revised=videoRequest({...base,speechTiming,opinion:'保持原动作。'},'regenerate');
 assert.ok(revised.prompt.includes(audio));assert.match(revised.prompt,/Revision instructions:\n保持原动作。/);
});

test('时序输入与视频hash同源，发声安排或说话人变化可识别，静默拍和媒体不混入',()=>{
 const{snapshot,shot}=fixture(),original=videoSpeechTiming(shot),hash=dependencyHash(snapshot,'video',shot.id);
 assert.deepEqual(original,[{time_range:'2–8s',audio,speakers:['巴比堪']}]);
 shot.seconds_storyboard.storyboard[0].audio='不相关的静默拍声音改变';assert.equal(dependencyHash(snapshot,'video',shot.id),hash);
 shot.seconds_storyboard.storyboard[1].audio='巴比堪约3–7秒连续发声';assert.notEqual(dependencyHash(snapshot,'video',shot.id),hash);
 const next=dependencyHash(snapshot,'video',shot.id);shot.seconds_storyboard.storyboard[1].dialogue[0].speaker_name='传令兵';assert.notEqual(dependencyHash(snapshot,'video',shot.id),next);
 original[0].speakers.push('修改副本');assert.deepEqual(videoSpeechTiming(shot)[0].speakers,['传令兵']);
 assert.doesNotMatch(JSON.stringify(videoSpeechTiming(shot)),/dialogue_text|\.mp4|\.png/);
});

test('无对白不新增时序段，未给明确发声秒数也不推算成整拍时长',()=>{
 const{shot}=fixture();for(const beat of shot.seconds_storyboard.storyboard)beat.dialogue=[];
 assert.deepEqual(videoSpeechTiming(shot),[]);
 const base={type:'文生',textPrompt,duration:15,aspectRatio:'16:9'};
 assert.equal(videoRequest({...base,speechTiming:[]}).prompt,videoRequest(base).prompt);
 const request=videoRequest({...base,speechTiming:[{time_range:'2–8s',audio:'自然连贯地说完后继续走向工人。',speakers:['巴比堪']}]});
 assert.match(request.prompt,/具体发声起止沿用声音安排，未明确的秒数不推算/);
 assert.match(request.prompt,/自然连贯地说完后继续走向工人/);
 assert.doesNotMatch(request.prompt,/2–7秒/);
});

test('时序资料仍经过输入形状及最终长度校验，不截断或绕过7000字限制',()=>{
 const base={type:'文生',textPrompt,duration:15,aspectRatio:'16:9'};
 assert.throws(()=>videoRequest({...base,speechTiming:[{time_range:'2–8s',audio,speakers:'巴比堪'}]}),/speechTiming/);
 assert.throws(()=>videoRequest({...base,speechTiming:[{time_range:'2–8s',audio:'长'.repeat(7000),speakers:[]}]}),/7000/);
});

test('每秒和最终提示词三动作共享1.1目标，审核沿用时序、短句与画面停留边界',()=>{
 const{snapshot,p,e,shot}=fixture();
 for(const business of ['seconds','storyboard'])for(const action of ['generate','review','regenerate']){
  const task=taskFixture(p,business,shot.id),prompt=renderTaskPrompt(snapshot,task,business==='seconds'?shot.seconds_storyboard:shot.text_to_video_prompt,action);
  assert.ok(prompt.system.includes(dialoguePaceRule));assert.equal(prompt.system.split(dialoguePaceRule).length,2);
  if(business==='seconds')assert.match(prompt.system,/发声区间可以短于所在拍/);
  else{assert.match(prompt.system,/发声起止必须明确转写/);assert.match(prompt.system,/不添加剪辑时间戳；对白发声起止/);}
 }
 for(const action of ['generate','regenerate']){
  const input={type:'文生',textPrompt,duration:15,aspectRatio:'16:9',speechTiming:videoSpeechTiming(shot),...(action==='regenerate'?{opinion:'保持原动作'}:{})};
  const prompt=composeNodePrompt('video',action,input,'MiniMax-H3');assert.ok(prompt.body.includes(dialoguePaceRule));assert.equal(prompt.body.split(dialoguePaceRule).length,2);
 }
});
