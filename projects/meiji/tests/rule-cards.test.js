import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderSkillDetail} from '../client/skill-detail.js';
import {createMediaHandler} from '../server/handlers/media-handler.js';
import {createAiRoutes} from '../server/http/ai-routes.js';
import {snapshotFixture,taskFixture} from './fixtures/project.js';
import {config} from './fixtures/ai.js';
import {defaultRules} from '../shared/rule-defaults.js';
import {emptySceneModel} from '../shared/models/scene_model.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('三标签页先补充卡后基础卡，基础及固定说明合成单份全文只读，无同步按钮或内部滚动',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const style=document.createElement('style');style.textContent=readFileSync(new URL('../client/panel-styles.css',import.meta.url),'utf8');document.head.append(style);
  const rules=Object.fromEntries(['generate','revise','review'].map(key=>[key,{base:'长基础规则\n'.repeat(100)+`结束_${key}`,supplement:`补充_${key}`}]))
  const page=renderSkillDetail({label:'测试节点',rules},{load:async()=>({generate:'生成输出格式',revise:'修订固定协议',review:'审核固定协议'}),back:()=>{}});
  document.querySelector('main').append(page);await settle();
  assert.equal(page.querySelector('textarea[aria-label="基础规则"]'),null);
  assert.ok(!page.textContent.includes('同步基础规则'));
  for(const [key,title,contract]of [['generate','生成规则','生成输出格式'],['revise','修订规则','修订固定协议'],['review','审核规则','审核固定协议']]){
   [...page.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent===title).click();
   const section=page.querySelector(`[data-rules="${key}"]`);assert.equal(section.hidden,false);
   const cards=[...section.querySelectorAll('.skill-rule-card')];assert.equal(cards.length,2);
   assert.equal(cards[0].querySelector('h3').textContent,'补充规则');assert.equal(cards[1].querySelector('h3').textContent,'基础规则');
   assert.equal(cards[0].querySelector('textarea').value,`补充_${key}`);
   const blocks=cards[1].querySelectorAll('pre');assert.equal(blocks.length,1);assert.equal(blocks[0].textContent,`${rules[key].base}\n\n${contract}`);
   const css=dom.window.getComputedStyle(blocks[0]);assert.equal(css.maxHeight,'none');assert.equal(css.overflow,'visible');
   assert.equal(blocks[0].getAttribute('contenteditable'),null);
  }
 }finally{globalThis.document=previous;dom.window.close();}
});

test('补充编辑只提交对应动作，失败回退；基础卡复制包括固定输出约束',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),writes=[],calls=[];
 globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>writes.push(text)}}});
 try{
  const rules=Object.fromEntries(['generate','review','revise'].map(a=>[a,{base:'基础全文',supplement:'原补充'}]));
  const page=renderSkillDetail({label:'测试',rules},{load:async()=>({generate:'固定输出JSON',revise:'修订协议',review:'审核协议'}),back:()=>{},onRule:(...args)=>{calls.push(args);if(args[3]&&args[2]==='失败补充')return Promise.reject(Error('保存失败'));}});
  document.querySelector('main').append(page);await settle();const section=page.querySelector('[data-rules="generate"]'),area=section.querySelector('textarea');
  area.value='新补充';area.dispatchEvent(new dom.window.Event('input'));area.dispatchEvent(new dom.window.Event('blur'));await settle();
  assert.deepEqual(calls,[['generate','supplement','新补充',false],['generate','supplement','新补充',true]]);
  section.querySelector('.skill-base button').click();await settle();assert.equal(writes[0],'基础全文\n\n固定输出JSON');
  section.querySelector('.skill-supplement-card button').click();await settle();assert.equal(writes[1],'新补充');
  area.value='失败补充';area.dispatchEvent(new dom.window.Event('blur'));await settle();assert.equal(area.value,'新补充');
 }finally{globalThis.document=previous;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;dom.window.close();}
});

test('图片和视频媒体处理器忽略旧base快照，使用代码基础及本动作补充',async()=>{
 const snapshot=snapshotFixture(),p=snapshot.project,shot=p.episodes[0].shot_list.shots[0],scene=emptySceneModel({name:'场地',description:'空地'});
 p.scene_library.scenes.push(scene);shot.text_to_video_prompt.overall_soundscape='风声';shot.text_to_video_prompt.non_diegetic_music='N/A';const calls=[];
 for(const [business,node,id]of [['video',shot.video,shot.id],['scene-image',scene.reference_image,scene.id]]){
  node.rules.generate.base='禁止参与执行的旧基础';node.rules.generate.supplement=`补充_${business}`;
  const ai=createAiRoutes({readConfig:async()=>({...config,video:{model:'MiniMax-H3'}}),gateway:{image:async options=>{calls.push(options);return Buffer.from('image');},video:async options=>{calls.push(options);return{taskId:'remote',url:'https://example.test/video'};}}});
  const handler=createMediaHandler({ai,media:{put:async()=>({address:'image.png'})}});
  await handler({snapshot,task:taskFixture(p,business,id,{action:'generate'}),step:{kind:'generate'},signal:new AbortController().signal,record:async()=>{}});
  const last=calls.at(-1);assert.ok(!last.prompt.includes('禁止参与执行的旧基础'));assert.ok(last.prompt.includes(`补充_${business}`));assert.ok(last.prompt.includes(defaultRules(business).generate.base));
  assert.equal(node.rules.generate.base,'禁止参与执行的旧基础');
 }
});
