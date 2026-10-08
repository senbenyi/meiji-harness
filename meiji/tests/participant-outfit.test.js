import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from './fixtures/jsdom.js'
import {episodeFixture,setupModel} from './fixtures/model.js'
import {reviewPass} from './fixtures/review-result.js'
import {setContent} from '../shared/drama-model.js'
import {parseSecondsResponse,parseSecondsPartial,validateSeconds,secondsText} from '../shared/seconds-content.js'
import {compileVideoPrompt} from '../server/prompts/video-prompt-renderer.js'
import {storyboardReady} from '../server/flow/steps/shared/film-freshness.js'
import {filmSubmit} from '../server/flow/steps/shared/video-submit.js'
import {buildSecondsPrompts} from '../server/prompts/shot-text-prompts.js'
import {filmParticipants} from '../shared/film-characters.js'
import {runOperation} from './fixtures/operation.js'
import {renderStage,renderShotPage} from '../client/generation-stage-views.js'
const clothing='白色衬衫、黑色长裤，外套敞开；本镜脱下外套后仍穿衬衫和长裤，外套置于椅背'
function named(p){const s=p.shots.items[0],c=s.seconds.content;c.version=2;c.participants=[{name:'旅人',presence:'visible',outfit:clothing}];for(const b of c.beats)for(const field of ['action','camera','space','sound','endState'])b[field]=b[field].replace(/【([^|]+)\|[^】]+】/g,'$1');c.beats[0].action='旅人解开外套并脱下，放在椅背';c.beats[0].endState='旅人仍穿白衬衫和黑长裤，外套在椅背';return s}

test('新v2参与人物着装必填且为一段文本，voice必须空；旧数据读取兼容',()=>{const p=episodeFixture(),s=named(p),c=s.seconds.content,parse=x=>parseSecondsResponse(JSON.stringify({shots:[x]}),[s],p);assert.doesNotThrow(()=>parse(c));for(const outfit of [undefined,'','   ',null,{},[]]){const bad=structuredClone(c);if(outfit===undefined)delete bad.participants[0].outfit;else bad.participants[0].outfit=outfit;assert.throws(()=>parse(bad),/outfit/)}const old=structuredClone(c);delete old.participants[0].outfit;assert.doesNotThrow(()=>validateSeconds(old,s,p));assert.match(secondsText(old),/旅人着装：未记录/);assert.match(parseSecondsPartial(JSON.stringify({shots:[old]}),[s],p).failures.S01,/outfit/);const voice=structuredClone(c);voice.participants=[{name:'旅人',presence:'voice',outfit:''}];assert.doesNotThrow(()=>parse(voice));voice.participants[0].outfit='黑衣';assert.throws(()=>parse(voice),/仅声音/);assert.doesNotThrow(()=>parse({...c,participants:[]}))})

test('每秒生成和审核协议包含outfit单段说明及示例，未恢复已删除具体限制句',()=>{const p=episodeFixture(),s=named(p),prompts=buildSecondsPrompts({project:p,shotId:s.id});for(const message of [prompts.generation,prompts.revision('基稿','修改着装')]){assert.match(message.system,/name,presence,outfit/);assert.match(message.system,/"outfit":"深灰长衣/);assert.match(message.system,/不返回起始\/结束两个着装字段/);assert.doesNotMatch(message.system,/脱下外套不等于|解扣\/拉开衣服不等于/)}assert.match(prompts.review(JSON.stringify(s.seconds.content)).system,/outfit.*一段着装描述/s)})

test('有图/无图直接编译本镜着装，固定服装不覆盖，原角色与对白保持',()=>{for(const image of [null,{localPath:'/person.png',assetId:'person'}]){const p=episodeFixture(),s=named(p);p.plot.characters.items[0].image.content=image;const before=structuredClone(p),out=compileVideoPrompt(p,s);assert.ok(out.prompt.text.includes(clothing));assert.match(out.prompt.text,/本镜着装/);assert.doesNotMatch(out.prompt.text,/服装：长衣/);assert.deepEqual(out.outfitSnapshot,[{name:'旅人',outfit:clothing}]);assert.ok(out.sourceMap.some(source=>source.sources?.includes('participants.outfit')));assert.deepEqual(p,before)}})

test('仅声音不产生着装或图片；跨镜角色汇总不把着装当成固定资料',()=>{const p=episodeFixture(),s=named(p);s.seconds.content.participants=[{name:'旅人',presence:'voice',outfit:''}];for(const b of s.seconds.content.beats)for(const field of ['action','camera','space','endState'])b[field]='空庭院，风吹草叶';const out=compileVideoPrompt(p,s);assert.deepEqual(out.outfitSnapshot,[]);assert.doesNotMatch(out.prompt.text,/本镜着装/);assert.deepEqual(filmParticipants(p),null);p.shots.items=[s];assert.deepEqual(filmParticipants(p),[{name:'旅人',presence:'voice'}])})

test('前镜交接携带着装段及末态，末态决定下一镜承接',()=>{const p=episodeFixture(),s=named(p),text=buildSecondsPrompts({project:p,shotId:'S02'}).generation.user;assert.ok(text.includes(clothing));assert.match(text,/outfits/);assert.ok(text.includes(s.seconds.content.beats[0].endState))})

test('着装变更即使revision未变也使编排过期并阻止提交；旧无着装编排仍可用',()=>{const p=episodeFixture(),s=named(p),board=compileVideoPrompt(p,s);setContent(s.storyboard,board,{passed:true,failures:[]});assert.equal(storyboardReady(p,s.id),true);s.seconds.content.participants[0].outfit='蓝色衬衫、灰色长裤';assert.equal(storyboardReady(p,s.id),false);assert.throws(()=>filmSubmit(p,{id:s.id,...board},{}),/着装已变化/);delete s.seconds.content.participants[0].outfit;const old=compileVideoPrompt(p,s);delete old.outfitSnapshot;setContent(s.storyboard,old,{passed:true,failures:[]});assert.equal(storyboardReady(p,s.id),true);assert.doesNotThrow(()=>filmSubmit(p,{id:s.id,...old},{}))})

test('真实每秒生成保存outfit且最终程序编译复用，角色与库未改写',async t=>{const e=await setupModel(t),p=await e.read(),s=named(p),before=await e.read();await runOperation(e.op('shot-seconds',{track:s.id}),{home:e.home,request:async message=>message.skill==='review'?reviewPass:JSON.stringify({shots:[s.seconds.content]})});const saved=await e.read(),shot=saved.shots.items[0];assert.equal(shot.seconds.content.participants[0].outfit,clothing);assert.equal(shot.seconds.check.passed,true);assert.deepEqual(saved.plot.characters.items,before.plot.characters.items);assert.deepEqual(saved.library,before.library);assert.ok(compileVideoPrompt(saved,shot).prompt.text.includes(clothing))})

test('每秒列表和单镜详情UI均显示每名人物的着装段',t=>{const dom=new JSDOM('<body></body>'),prior={document:globalThis.document,window:globalThis.window};Object.assign(globalThis,{document:dom.window.document,window:dom.window});t.after(()=>{Object.assign(globalThis,prior);dom.window.close()});const p=episodeFixture(),s=named(p),actions={perform:()=>assert.fail('展示不请求模型'),fail:()=>{}};for(const page of [renderStage('seconds',p,actions,{}),renderShotPage(p,s,actions,{shotTab:'seconds'})]){assert.ok(page.textContent.includes('旅人着装：'+clothing));assert.match(page.textContent,/参与人物：旅人（出镜）/)}})
