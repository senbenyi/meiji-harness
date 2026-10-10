import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate,renderTemplate } from '../server/prompts/yaml-prompts.js';
import { promptValues } from '../server/handlers/text-handler.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { mergeCharacters } from '../shared/collection-identity.js';
for(const suffix of ['generate','regenerate','review'])test(`镜头表${suffix}输入包含实际服装编号及总秒数`,async()=>{
 const s=snapshotFixture(),p=s.project,e=p.剧集[0];
 p.角色库.角色=mergeCharacters(p,[{编号:'C01',名称:'测试人物',国籍:'',身份:'',身份特征:'',性别:'',年代:'',年龄:'',身高:'',体型:'',面相:'',声音:'',必出:true,默认服装编号:'C01-01',服装:[{编号:'C01-01',名称:'唯一服装',描述:'灰衣'}]}]).characters;
 e.本集资产.角色=[{角色id:p.角色库.角色[0].id,出镜:'出镜'}];
 const t=taskFixture(p,'shots',e.id,{opinion:''}),values=promptValues(s,t,{},suffix==='review'?'review':'generate');
 const rendered=renderTemplate(await loadTemplate(`shots-${suffix}`),values);
 assert.match(rendered.user,/C01-01/);assert.match(rendered.user,/唯一服装/);assert.match(rendered.user,/本集总时长秒[\s\S]*10/);
 assert.match(rendered.system,/不创建服装/);
});
