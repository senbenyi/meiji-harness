import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { shotCharacterContext } from '../shared/node-dependencies.js';
import { characterTextCatalog } from '../shared/shot-text-inputs.js';
import { projectFixture } from './fixtures/project.js';

const character = {
  number:'C01',name:'武松',gender:'男',era:'古代',position:'角色定位标记',age_range:'年龄标记',
  body_type:'体型标记',hairstyle:'发型标记',signature_props:['道具标记'],immutable_traits:['特征标记'],
  voice:'声线标记',costumes:[{number:'C01-01',name:'灰褐短打',color:'颜色标记',material:'材质标记',props:['服装道具标记']}],
};
for (const action of ['generate','regenerate','review']) test(`镜头表${action}目录只发送姓名/服装名，原文身份和调用方输入不变`, () => {
  const input={language:'zh-CN',requirements:'',segments:[{sequence:1,duration_seconds:10,body:'现代消防员林峥推开燃烧的门。',causal:''}],duration:10,characters:[structuredClone(character)]};
  if(action!=='review')input.shotNumbers=[];
  if(action!=='generate')Object.assign(input,{opinion:'保留原文身份',content:{shots:[]}});
  const before=structuredClone(input);
  const prompt=composeNodePrompt('shots',action,input,'qwen3.5:27b');
  const user=prompt.messages.find(m=>m.role==='user').content;
  const section=user.split('## 项目角色姓名与服装名称目录\n')[1].split('\n\n#')[0].trim();
  assert.deepEqual(JSON.parse(section),[{name:'武松',costumes:[{name:'灰褐短打'}]}]);
  assert.match(user,/现代消防员林峥推开燃烧的门/);
  assert.doesNotMatch(user,/角色定位标记|年龄标记|体型标记|发型标记|道具标记|特征标记|声线标记|颜色标记|材质标记/);
  assert.deepEqual(input,before);
  assert.equal(prompt.messages.length,action==='regenerate'?4:2);
});

test('目录精简不改变依赖资料，逐镜角色资料仍保留完整文字', () => {
  const project=projectFixture();project.character_library.characters=[structuredClone(character)];
  const before=shotCharacterContext(project);
  composeNodePrompt('shots','generate',{language:'zh-CN',requirements:'',segments:[],duration:10,characters:before,shotNumbers:[]},'qwen3.5:27b');
  assert.deepEqual(shotCharacterContext(project),before);
  const full=characterTextCatalog(project)[0];
  for(const key of ['position','age_range','body_type','hairstyle','signature_props','immutable_traits'])assert.deepEqual(full[key],character[key]);
  assert.equal(full.costumes[0].color,character.costumes[0].color);
  assert.equal(full.costumes[0].material,character.costumes[0].material);
});
