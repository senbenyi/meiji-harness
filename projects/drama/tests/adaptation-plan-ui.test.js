import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {renderAdaptationPlan,emptyAdaptationPlan} from '../src/node_box/adaptation_plan/ui/plan-panel.js';
import {fixture as productionFixture} from './helpers/production-fixture.js';

function fixture(t,{value=emptyAdaptationPlan(),reject=false}={}){
 const dom=new JSDOM('<main class="production-workspace"/>'),prior=globalThis.document;
 globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.show=function(){this.open=true};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const root=document.querySelector('main');let plan=structuredClone(value),panel,fail=reject,saves=0;
 const paint=()=>{panel?.dispose();root.replaceChildren();panel=renderAdaptationPlan(root,{value:plan,onChange:async next=>{if(fail)throw new Error('保存暂不可用');saves++;plan=next;paint()}})};
 paint();t.after(()=>{panel.dispose();globalThis.document=prior;dom.window.close()});
 const click=(text,scope=root)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===text).click();
 const submit=()=>root.querySelector('dialog form').onsubmit({preventDefault(){}});
 return {root,click,submit,get value(){return plan},get saves(){return saves},retry(){fail=false}};
}

test('规划文本完整安全展示，不把原稿内容作为HTML执行',t=>{
 const value=emptyAdaptationPlan();value.story_direction.main_plot='<script>危险文本</script>\n完整主线';value.character_plans=[{original_content:'同名人物\n原著身份',adaptation_plan:'<img src=x onerror=alert(1)>\n改编方案'}];
 const f=fixture(t,{value});assert.equal(f.root.querySelector('script,img'),null);
 assert.match(f.root.textContent,/<script>危险文本<\/script>\n完整主线/);
 assert.match(f.root.textContent,/同名人物\n原著身份/);
 assert.deepEqual([...f.root.querySelectorAll('.production-guidance-group>h3')].map(n=>n.textContent),['改编定位','故事方向','人物规划','团队规划','场景规划']);
 assert.equal(f.root.querySelectorAll('.production-guidance-group').length,5);
});

test('受众与风格按键值行展示并独立编辑，不改动其他规划',async t=>{
 const value=emptyAdaptationPlan();value.audience='成年观众';value.style='写实风格';value.story_direction.main_plot='既有主线';
 const f=fixture(t,{value});
 assert.deepEqual([...f.root.querySelectorAll('.adaptation-plan-properties dt')].map(node=>node.textContent),['受众：','风格：']);
 assert.deepEqual([...f.root.querySelectorAll('.adaptation-plan-properties dd')].map(node=>node.textContent),['成年观众','写实风格']);
 assert.equal(f.root.querySelector('[data-guidance-group=overview] .production-card'),null);
 for(const [key,title,text] of [['audience','受众','家庭观众'],['style','风格','轻松\n温暖']]){
  const before=structuredClone(f.value);
  f.root.querySelector('[aria-label="编辑'+title+'"]').click();f.root.querySelector('dialog [aria-label="'+title+'"]').value=text;await f.submit();
  assert.deepEqual(f.value,{...before,[key]:text});assert.equal(f.root.querySelector('dialog'),null);
 }
});

test('无ID且内容相同的规划按列表位置编辑，失败保留输入后可重试',async t=>{
 const value=emptyAdaptationPlan(),item={original_content:'同一人物',adaptation_plan:'同一方案'};value.character_plans=[item,{...item}];
 const f=fixture(t,{value,reject:true}),cards=f.root.querySelectorAll('[data-guidance-group=character_plans] .production-card');
 f.click('编辑此项',cards[1]);f.root.querySelector('[aria-label=改编方案]').value='第二项的新方案';
 await f.submit();assert.match(f.root.querySelector('dialog .error').textContent,/保存暂不可用/);
 assert.equal(f.root.querySelector('[aria-label=改编方案]').value,'第二项的新方案');assert.equal(f.saves,0);
 f.retry();await f.submit();assert.equal(f.root.querySelector('dialog'),null);
 assert.equal(f.value.character_plans[0].adaptation_plan,'同一方案');assert.equal(f.value.character_plans[1].adaptation_plan,'第二项的新方案');
 assert.deepEqual(value.character_plans,[item,item]);
});

test('不提供人物团队场景新增入口，已有项可编辑取消及删除',async t=>{
 const value=emptyAdaptationPlan();value.group_plans=[{original_content:'守卫队：原著组织',adaptation_plan:'强化成员分歧'}];
 const f=fixture(t,{value});
 const assertNoAdd=()=>{for(const label of ['添加人物规划','添加团队规划','添加场景规划'])assert.equal([...f.root.querySelectorAll('button')].some(b=>b.textContent===label),false)};
 assertNoAdd();f.click('编辑此项');f.root.querySelector('[aria-label=原著内容]').value='临时修改';f.click('取消');assert.equal(f.saves,0);
 f.click('编辑此项');f.root.querySelector('[aria-label=原著内容]').value=' ';await f.submit();assert.match(f.root.querySelector('dialog .error').textContent,/请填写/);assert.equal(f.saves,0);
 f.root.querySelector('[aria-label=原著内容]').value='守卫队：新描述';await f.submit();
 assert.deepEqual(f.value.group_plans,[{original_content:'守卫队：新描述',adaptation_plan:'强化成员分歧'}]);
 await [...f.root.querySelectorAll('[data-guidance-group=group_plans] button')].find(b=>b.textContent==='删除此项').onclick();
 assert.deepEqual(f.value.group_plans,[]);assert.match(f.root.querySelector('[data-guidance-group=group_plans]').textContent,/暂无团队规划/);
 assertNoAdd();
});

test('列表支持逐项增删和段内换行，取消与空行不会污染数据',async t=>{
 const value=emptyAdaptationPlan();value.story_direction.must_preserve=['保留情节一','保留情节二'];
 const f=fixture(t,{value});f.click('编辑必须保留的情节');
 f.root.querySelector('[aria-label="必须保留的情节 1"]').value='保留相见\n保留原话';
 f.root.querySelector('[aria-label="删除必须保留的情节 2"]').click();f.click('添加必须保留的情节');
 await f.submit();assert.deepEqual(f.value.story_direction.must_preserve,['保留相见\n保留原话']);
 assert.deepEqual(value.story_direction.must_preserve,['保留情节一','保留情节二']);
});

test('模拟生成到人工保存走真实harness-http入口，磁盘节点无版本字段与重复状态',async t=>{
 const f=await productionFixture(t);await f.run('source_analysis');const detail=await f.run('adaptation_plan');
 let project=await f.project();const value={...project.adaptation_plan.data,style:'人工修改后的写实风格'};
 const response=await fetch(f.api+'/project?session_id='+f.context.sessionId,{method:'PATCH',headers:{'Content-Type':'application/json','X-Drama-Request':'1'},body:JSON.stringify({project_id:f.created.project_id,request_id:'new-plan-ui-save',command:{kind:'product',stage:'adaptation_plan',value}})});
 assert.equal(response.status,200);project=(await response.json()).project;
 const stored=JSON.parse(await readFile(f.projects.documents.directory(f.created.project_id)+'/project.json','utf8'));
 assert.deepEqual(stored.adaptation_plan.data,value);assert.deepEqual(stored.adaptation_plan,project.adaptation_plan);
 assert.deepEqual(Object.keys(stored.adaptation_plan),['id','type','data','state']);
 assert.equal(Object.hasOwn(stored.node_states,'adaptation_plan'),false);
 assert.equal(Object.hasOwn(stored.adaptation_plan.state,'product_revision'),false);
 assert.equal(stored.adaptation_plan.state.checkpoint,null);assert.equal(stored.adaptation_plan.state.status,'draft');
 assert.ok(detail.steps.some(step=>step.kind==='generate'));
 assert.ok(detail.steps.filter(step=>step.result?.candidate_ref).every(step=>!Object.hasOwn(step.result,'product_revision')));
});
