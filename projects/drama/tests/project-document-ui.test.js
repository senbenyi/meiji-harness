import {makePlan} from './helpers/adaptation-plan.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {readFile} from 'node:fs/promises'
import {projectDialog} from '../src/node_box/project/ui/panel/project-forms.js'
import {createProjectDocumentView} from '../src/client/project-document-view.js'
import {createProjectDocument,editProjectProduct} from '../src/drama_runtime/drama_document.js'
const tick=()=>new Promise(r=>setImmediate(r))
function fixture(t){const dom=new JSDOM('<main/>'),previous=globalThis.document;dom.window.HTMLDialogElement.prototype.show=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()});return {dom,root:document.querySelector('main')}}
test('左侧九个制作tab对齐文档顺序，默认改编规划，键盘切换与内容对应',async t=>{
 const {dom,root}=fixture(t),p=createProjectDocument({id:'p_ui',name:'新流程'}),view=createProjectDocumentView(root,{project:p,save:async()=>p,request:async()=>({body:''})});t.after(()=>view.dispose())
 const design=JSON.parse(await readFile(new URL('../docs/data/a_drama_detail.json',import.meta.url),'utf8'))
 const tabs=()=>[...root.querySelectorAll('[role=tab]')],selected=()=>root.querySelector('[aria-selected=true]')
 assert.equal(root.querySelector('[role=tablist]').getAttribute('aria-orientation'),'vertical')
 assert.deepEqual(tabs().map(tab=>tab.dataset.node),Object.keys(design.data))
 assert.deepEqual(tabs().map(tab=>tab.dataset.stage),['adaptation_plan','story_segments','asset_preparation','shot_design','clip_arrangement','video_prompt','video_render','editing','delivery'])
 assert.equal(tabs()[0].querySelector('.production-step-title').textContent,'1. 改编规划')
 assert.equal(tabs()[2].querySelector('.production-step-title').textContent,'3. 核心资产准备')
 assert.equal(tabs()[3].querySelector('.production-step-title').textContent,'4. 分镜')
 assert.equal(tabs()[5].querySelector('.production-step-title').textContent,'6. 视频提示词')
 assert.equal(root.querySelector('[data-stage=reference_binding]'),null)
 assert.equal(selected().dataset.stage,'adaptation_plan')
 assert.equal(root.querySelector('.production-workflow-heading span').textContent,'9 个步骤')
 assert.deepEqual([...root.querySelector('.production-workflow').children].slice(0,3).map(node=>node.className),['production-project-nav-title','production-project-nav','production-workflow-heading'])
 for(const tab of tabs()){
  tab.click()
  assert.equal(root.querySelector('.production-section').dataset.nodeType,tab.dataset.stage)
  assert.equal(root.querySelector('[role=tabpanel]').getAttribute('aria-labelledby'),'step-'+tab.dataset.stage)
  assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='人工编辑产物'))
 }
 const key=value=>selected().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true}))
 key('Home');assert.equal(selected().dataset.stage,'adaptation_plan')
 key('ArrowDown');assert.equal(selected().dataset.stage,'story_segments')
 key('ArrowDown');assert.equal(selected().dataset.stage,'asset_preparation')
 key('End');assert.equal(selected().dataset.stage,'delivery')
 key('ArrowDown');assert.equal(selected().dataset.stage,'adaptation_plan')
 key('ArrowUp');assert.equal(selected().dataset.stage,'delivery')
 assert.equal(document.activeElement,selected())
 root.querySelector('[data-stage=project]').click()
 assert.equal(selected(),null);assert.equal(root.querySelectorAll('[role=tab][tabindex="0"]').length,1)
 assert.equal(root.querySelector('[data-stage=project]').getAttribute('aria-pressed'),'true')
 assert.ok(root.querySelector('.project-script-import'))
})
test('文档剪辑导出节点映射原运行功能，未知选择回到首个tab',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_alias',name:'节点映射'})
 for(const [key,id,title]of [['video_editing','editing','视频剪辑'],['video_delivery','delivery','分集导出'],['reference_binding','adaptation_plan','改编规划'],['unknown','adaptation_plan','改编规划']]){
  const state={documentStage:key},view=createProjectDocumentView(root,{project:p,state})
  assert.equal(state.documentStage,id);assert.equal(root.querySelector('[aria-selected=true]').dataset.stage,id)
  assert.equal(root.querySelector('.production-section h3').textContent,title)
  view.dispose()
 }
})
test('产物编辑保存携带原版本，失败保留输入且不会修改只读规则',async t=>{
 const {root}=fixture(t);let p=createProjectDocument({id:'p_ui',name:'编辑'}),command,fail=true
 const state={documentStage:'adaptation_plan'},view=createProjectDocumentView(root,{project:p,state,request:async()=>({}),save:async c=>{command=c;if(fail)throw new Error('编辑冲突');p=editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision});return p}});t.after(()=>view.dispose())
 const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click()
 click('人工编辑产物');const input=root.querySelector('dialog textarea');input.value=JSON.stringify({...p.adaptation_plan,creative_constraints:{...p.adaptation_plan.creative_constraints,style:'人工目标'}});click('保存');await tick();assert.match(root.querySelector('dialog').textContent,/编辑冲突/);assert.match(input.value,/人工目标/)
 fail=false;click('保存');await tick();assert.equal(root.querySelector('dialog'),null);assert.equal(command.expected_revision,0);assert.match(root.textContent,/人工目标/);assert.match(root.textContent,/待核对/)
 click('查看规则');assert.equal(root.querySelector('textarea').readOnly,true);assert.equal([...root.querySelectorAll('dialog button')].some(b=>b.textContent==='保存'),false)
})

test('流程状态依据完成、未通过和真实失败，候选/取消不当完成，更新同步导航与标题',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_flow',name:'流程状态'});p.node_states.project.status='confirmed';p.node_states.clip_arrangement.status='rejected';p.node_states.adaptation_plan.status='draft';p.node_states.story_segments.status='confirmed';const executionStates={story_segments:{task_id:'failed',status:'failed',reason:'模型连接失败'},shot_design:{task_id:'cancelled',status:'cancelled',reason:'用户停止'}}
 const state={documentStage:'story_segments'},view=createProjectDocumentView(root,{project:p,state,executionStates});t.after(()=>view.dispose());const tab=id=>root.querySelector(`[data-stage=${id}]`)
 assert.equal(tab('project').dataset.tone,'complete');assert.equal(tab('clip_arrangement').dataset.tone,'error');assert.equal(tab('adaptation_plan').dataset.tone,'pending');assert.match(tab('adaptation_plan').textContent,/待核对/);assert.equal(tab('story_segments').dataset.tone,'error');assert.match(tab('shot_design').textContent,/已停止/);assert.match(root.querySelector('.production-progress').textContent,/0 \/ 9/);assert.equal(root.querySelector('.production-section').dataset.tone,'error');assert.match(root.querySelector('[role=status]').textContent,/模型连接失败/)
 const next=structuredClone(p);next.node_states.story_segments.status='confirmed';executionStates.story_segments.status='completed';view.update(next,{executionStates});assert.equal(tab('story_segments').dataset.tone,'complete');assert.match(root.querySelector('.production-section .node-data-tag').textContent,/已完成/);assert.match(root.querySelector('.production-progress').textContent,/1 \/ 9/)
})

test('续接按钮直接使用独立任务状态的group，不再查询历史或依赖JSON缓存',async t=>{
 const {root}=fixture(t),project=createProjectDocument({id:'p_resume',name:'续接'}),requests=[],executionStates={story_segments:{task_id:'failed',group_id:'g_actual',status:'failed',reason:'执行中断'}}
 const view=createProjectDocumentView(root,{project,executionStates,state:{documentStage:'story_segments'},request:async(path,options)=>{
  requests.push({path,body:options?.body?JSON.parse(options.body):null})
  if(path==='project')return {project,execution_states:executionStates}
  if(path==='production/story_segments')return {group_id:'g_next'}
  throw Error('不应查询额外历史：'+path)
 }});t.after(()=>view.dispose())
 await [...root.querySelectorAll('button')].find(b=>b.textContent==='从检查点继续').onclick();await tick()
 assert.equal(requests.find(r=>r.path==='production/story_segments').body.resume_of,'g_actual');assert.equal(requests.some(r=>r.path.startsWith('task-history')),false)
 assert.equal(Object.hasOwn(project.node_states.story_segments,'last_execution'),false)
})

test('活动执行优先于旧失败，不把执行中染为完成或错误',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_active',name:'运行状态'});p.node_states.clip_arrangement.status='partial';const execution_states={clip_arrangement:{task_id:'old',status:'failed',reason:'上次失败'}}
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},sessionId:'session',request:async()=>({project:p,execution_states,active_execution:{group:{id:'active'},task:{node_type:'clip_arrangement',metadata:{production:true}}}})});t.after(()=>view.dispose());await tick();const tab=root.querySelector('[data-stage=clip_arrangement]');assert.equal(tab.dataset.running,'true');assert.equal(tab.dataset.tone,'pending');assert.match(tab.textContent,/执行中/);assert.match(root.querySelector('.production-section .node-data-tag').textContent,/执行中/)
})

test('短剧信息在短剧与原稿编辑，删除在顶部工具末尾，版本和意见保留',async t=>{
 const {dom,root}=fixture(t);let p=createProjectDocument({id:'p_layout',name:'入口调整'}),saved,removed=0;const state={documentStage:'delivery'},view=createProjectDocumentView(root,{project:p,state,remove:()=>removed++,request:async()=>({}),save:async c=>{saved=c;p={...p,basic_info:{...p.basic_info,...c.value}};return p}});t.after(()=>view.dispose());const buttons=label=>[...root.querySelectorAll('button')].filter(b=>b.textContent===label),click=label=>buttons(label)[0].click()
 assert.equal(buttons('编辑短剧信息').length,0);assert.equal(buttons('删除短剧').length,1);assert.equal(root.querySelectorAll('.production-project-tools button').length,3);assert.equal(root.querySelector('.production-project-tools').lastElementChild.textContent,'删除短剧');assert.equal(buttons('执行本步骤').length,0);assert.equal(buttons('按设置分集并导出').length,1)
 root.querySelector('[data-stage=clip_arrangement]').click();assert.equal(root.querySelector('.node-ui-execution button').textContent,'执行本步骤');const opinion=root.querySelector('.node-ui-opinion');opinion.value='尊重原著，保留对白';opinion.dispatchEvent(new dom.window.Event('input'));root.querySelector('[data-stage=project]').click();assert.equal(buttons('编辑短剧信息').length,1);assert.equal(root.querySelector('.production-project-header').textContent.includes('编辑短剧信息'),false);click('编辑短剧信息');assert.equal(root.querySelector('dialog textarea'),null);const input=root.querySelector('dialog [name=title]');input.value='新标题';await root.querySelector('dialog form').onsubmit({preventDefault(){}});await tick();assert.equal(saved.kind,'basic_info');assert.equal(saved.expected_revision,0);assert.match(root.querySelector('.production-project-header h2').textContent,/新标题/);assert.equal(removed,0);click('删除短剧');assert.equal(removed,1);root.querySelector('[data-stage=clip_arrangement]').click();assert.equal(root.querySelector('.node-ui-opinion').value,'尊重原著，保留对白')
})


test('短剧编辑复用旧字段弹框，失败保留输入/自定义语言，取消和销毁清理遮罩',async t=>{
 const {root}=fixture(t);let p=createProjectDocument({id:'p_form',name:'旧标题',output_language:'fr'}),command,fail=true;p.node_states.project.product_revision=4
 const view=createProjectDocumentView(root,{project:p,save:async value=>{command=value;if(fail)throw new Error('版本冲突，请刷新');p={...p,basic_info:{...p.basic_info,...value.value}};return p}});t.after(()=>view.dispose());root.querySelector('[data-stage=project]').click();const edit=()=>[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑短剧信息').click()
 edit();let dialog=root.querySelector('dialog');assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('textarea'),null);assert.equal(dialog.querySelector('[name=id]'),null);assert.equal(dialog.querySelector('[name=reference_episode_duration_seconds]'),null);assert.equal(dialog.querySelector('[name=output_language]'),null);dialog.querySelector('[name=title]').value='保留输入';dialog.querySelector('[name=aspect]').value='16:9';dialog.querySelector('[name=mode]').value='free';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(dialog.open,true);assert.match(dialog.querySelector('[role=alert]').textContent,/版本冲突/);assert.equal(dialog.querySelector('[name=title]').value,'保留输入');assert.equal(command.expected_revision,4)
 fail=false;await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(root.querySelector('dialog'),null);assert.equal(p.basic_info.output_language,'fr');assert.equal(p.basic_info.id,'p_form');assert.equal(p.basic_info.creation_mode,'自由创作');assert.equal(p.basic_info.aspect_ratio,'16:9');assert.equal(root.querySelector('.panel-dialog-overlay'),null)
 edit();[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='取消').click();assert.equal(root.querySelector('.panel-dialog-overlay'),null);edit();view.dispose();assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})

test('添加短剧保持原创建弹框与导入字段，不要求填写JSON',async t=>{
 const {root}=fixture(t);let submitted;const dialog=projectDialog(root,async fields=>{submitted=fields},{maxScriptBytes:24*1024*1024});assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('textarea'),null);assert.equal(dialog.querySelector('#project-mode').value,'script');dialog.querySelector('#title').value='新增短剧';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.match(dialog.querySelector('[role=alert]').textContent,/导入或选择剧本/);assert.equal(submitted,undefined)
 const file=dialog.querySelector('input[type=file]');Object.defineProperty(file,'files',{value:[{name:'原稿.txt',size:12,text:async()=> '第一章：张飞进入营帐。'}],configurable:true});await file.onchange();dialog.querySelector('#aspect').value='16:9';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(submitted.basic_info.name,'新增短剧');assert.equal(submitted.basic_info.aspect_ratio,'16:9');assert.equal(submitted.basic_info.original_script_filename,'原稿.txt');assert.equal(submitted.basic_info.original_script,'第一章：张飞进入营帐。');assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})

test('编辑与添加共用创建表单，回填当前原稿且不读正文，换稿随资料一次提交',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_shared',name:'已有短剧',output_language:'fr'});p.source={current_revision_id:'src_old',revisions:[{id:'src_old',file_ref:'sources/old.txt',original_name:'旧稿.txt',character_count:10000000}]};let command;const requests=[]
 const view=createProjectDocumentView(root,{project:p,request:async path=>{requests.push(path);if(path==='library')return {assets:[{id:'script_one',category:'scripts',originalName:'素材新稿.txt'}]};if(path==='library/scripts/script_one')return {body:'新的完整原稿'};throw Error('不应读取旧原稿')},save:async value=>{command=value;return p}});t.after(()=>view.dispose());root.querySelector('[data-stage=project]').click();[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑短剧信息').click();const dialog=root.querySelector('dialog');assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('[name=title]').value,'已有短剧');assert.match(dialog.querySelector('.script-selected').textContent,/旧稿.txt/);assert.equal(requests.length,0);assert.equal(dialog.querySelector('textarea'),null)
 await dialog.querySelector('.script-choose').onclick();const picker=dialog.querySelector('.script-picker');picker.value='script_one';await picker.onchange();dialog.querySelector('[name=title]').value='新资料';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(command.kind,'basic_info');assert.equal(command.value.output_language,'fr');assert.equal(command.value.name,'新资料');assert.deepEqual(command.source,{text:'新的完整原稿',original_name:'素材新稿.txt'});assert.equal(command.expected_revision,0);assert.equal(root.querySelector('dialog'),null)
})

test('原稿页仅本地与素材库导入，库导入带版本；切换后迟到读取不提交',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_imports',name:'双入口'});let command,release,held=false;const state={documentStage:'project'};const view=createProjectDocumentView(root,{project:p,state,request:async path=>path==='library'?{assets:[{id:'script',category:'scripts',originalName:'素材.txt'}]}:held?new Promise(resolve=>{release=()=>resolve({body:'迟到原稿'})}):{body:'库原稿'},save:async value=>{command=value;return p}});t.after(()=>view.dispose());assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='导入/修改原稿'),false);assert.equal(root.querySelector('textarea'),null)
 let choose=root.querySelector('.project-script-import .script-choose');assert.equal(choose.textContent,'素材库导入');assert.equal(root.querySelector('.project-script-import .script-import').textContent,'本地导入');await choose.onclick();let picker=root.querySelector('.script-picker');picker.value='script';await picker.onchange();assert.equal(command.kind,'import_script');assert.equal(command.originalName,'素材.txt');assert.equal(command.value,'库原稿');assert.equal(command.expected_revision,0)
 command=null;held=true;await root.querySelector('.script-choose').onclick();picker=root.querySelector('.script-picker');picker.value='script';const reading=picker.onchange();root.querySelector('[data-stage=clip_arrangement]').click();release();await reading;assert.equal(command,null)
})

test('活动任务冲突只属于触发节点，任务结束后轮询清理且未开始节点不受影响',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_conflict',name:'冲突清理'});p.node_states.clip_arrangement.status='confirmed';let poll,active={group:{id:'busy'},task:{node_type:'story_segments',metadata:{production:true}}}
 t.mock.method(globalThis,'setInterval',callback=>{poll=callback;return {}});t.mock.method(globalThis,'clearInterval',()=>{})
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},request:async path=>{if(path==='project')return {project:p,active_execution:active};throw new Error('短剧已有执行任务')}});t.after(()=>view.dispose())
 const notice=()=>root.querySelector('.node-ui-failure'),generate=()=>[...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick()
 await generate();assert.equal(notice().textContent,'短剧已有执行任务');assert.match(root.querySelector('.node-data-tag').textContent,/已完成/)
 root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(notice().hidden,true);root.querySelector('[data-stage=clip_arrangement]').click();assert.equal(notice().textContent,'短剧已有执行任务')
 active=null;poll();await tick();assert.equal(notice().hidden,true);assert.match(root.querySelector('.node-data-tag').textContent,/已完成/);root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(notice().hidden,true)
})

test('冲突响应迟到但刷新已无活动任务时立即清理，不依赖partial状态',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_done',name:'已结束'});p.node_states.clip_arrangement.status='confirmed';let reads=0
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},request:async path=>{if(path==='project'){reads++;return {project:p,active_execution:null}}throw new Error('短剧已有执行任务')}});t.after(()=>view.dispose())
 await [...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick();assert.equal(reads,1);assert.equal(root.querySelector('.node-ui-failure').hidden,true)
})

test('迟到执行错误归原节点，普通错误刷新不丢，重试成功后清理并保留真实历史失败',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_late',name:'迟到错误'});let reject,fail=true
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},request:async path=>path==='project'?{project:p,active_execution:null}:fail?new Promise((_,no)=>{reject=no}):{group_id:'success'}});t.after(()=>view.dispose())
 const generate=()=>[...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick(),pending=generate();await tick();root.querySelector('[data-stage=adaptation_plan]').click();reject(new Error('模型连接失败'));await pending;assert.equal(root.querySelector('.node-ui-failure').hidden,true)
 root.querySelector('[data-stage=clip_arrangement]').click();assert.equal(root.querySelector('.node-ui-failure').textContent,'模型连接失败');view.update(structuredClone(p));assert.equal(root.querySelector('.node-ui-failure').textContent,'模型连接失败')
 fail=false;await generate();assert.equal(root.querySelector('.node-ui-failure').hidden,true)
 const failed=structuredClone(p);view.update(failed,{executionStates:{clip_arrangement:{task_id:'failed',status:'failed',reason:'供应商返回真实失败'}}});assert.equal(root.querySelector('.node-ui-failure').textContent,'供应商返回真实失败')
})

test('仅真实执行中的当前节点显示加载圆环，结束隐藏受理提示并保留失败原因',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_spinner',name:'加载状态'});p.node_states.clip_arrangement.status='partial';p.node_states.clip_arrangement.reason='任务已受理';let poll,active={group:{id:'working'},task:{node_type:'clip_arrangement',metadata:{production:true}}}
 t.mock.method(globalThis,'setInterval',callback=>{poll=callback;return {}});t.mock.method(globalThis,'clearInterval',()=>{})
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},sessionId:'session',request:async()=>({project:p,active_execution:active})});t.after(()=>view.dispose());await tick()
 const notice=()=>root.querySelector('.node-ui-failure');assert.equal(notice().getAttribute('aria-label'),'执行中');assert.equal(notice().getAttribute('aria-busy'),'true');assert.ok(notice().querySelector('.original-summary-loading'));assert.equal(notice().textContent,'');assert.equal(notice().hidden,false)
 root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(root.querySelector('.original-summary-loading'),null);assert.equal(notice().hidden,true);root.querySelector('[data-stage=clip_arrangement]').click();assert.ok(notice().querySelector('.original-summary-loading'))
 active=null;p.node_states.clip_arrangement.status='confirmed';poll();await tick();assert.equal(root.querySelector('.original-summary-loading'),null);assert.equal(notice().hidden,true);assert.equal(notice().hasAttribute('aria-busy'),false)
 view.update(p,{executionStates:{clip_arrangement:{task_id:'failed',status:'failed',reason:'审核未通过'}}});assert.equal(notice().textContent,'审核未通过');assert.equal(notice().hidden,false)
})

test('联合改编约束按完整文本列表展示，实体编辑保留且空列表不生成卡片',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_requirements',name:'完整约束'});p.adaptation_plan.creative_constraints.locked_requirements=['本单元覆盖原稿0—1200字符。','保留原著人物关系与关键对白。'];p.adaptation_plan.character_plans=[{id:'cp_one',name:'张飞',description:'勇猛',motivation:'迎战',relationships:'对峙',arc:'坚守'}];p.node_states.adaptation_plan.product_revision=3;let saved
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async command=>{saved=command;return p}});t.after(()=>view.dispose());let cards=[...root.querySelectorAll('.production-card')],requirements=root.querySelector('[data-guidance-group=creative_constraints] .production-card');assert.ok(requirements);assert.match(requirements.textContent,/1\. 本单元覆盖原稿0—1200字符。/);assert.match(requirements.textContent,/2\. 保留原著人物关系与关键对白。/);assert.doesNotMatch(requirements.textContent,/locked_requirements|0：本|1：单/)
 const character=cards.find(card=>card.querySelector('h4')?.textContent==='张飞');assert.ok(character);[...character.querySelectorAll('button')].find(button=>button.textContent==='编辑此项').click();root.querySelector('dialog [aria-label=描述]').value='勇猛忠诚';await [...root.querySelectorAll('dialog button')].find(button=>button.textContent==='保存').onclick();assert.equal(saved.kind,'product');assert.equal(saved.stage,'adaptation_plan');assert.equal(saved.expected_revision,3);assert.equal(saved.value.character_plans[0].description,'勇猛忠诚');assert.deepEqual(saved.value.creative_constraints.locked_requirements,p.adaptation_plan.creative_constraints.locked_requirements)
 const empty=createProjectDocument({id:'p_empty',name:'无产物'});view.update(empty);assert.equal(root.querySelectorAll('[data-guidance-group=character_plans]').length,0);assert.match(root.querySelector('.production-empty').textContent,/暂无改编规划产物/)
})

test('旧原著解析选择回到改编规划，移除入口且保留后台解析产物',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_legacy_stage',name:'旧选择'}),state={documentStage:'source_analysis'}
 p.source_analysis.chapters=[{id:'chapter',sequence:1,title:'原稿',body:'完整正文',summary:''}]
 const before=JSON.stringify(p),view=createProjectDocumentView(root,{project:p,state});t.after(()=>view.dispose())
 assert.equal(state.documentStage,'adaptation_plan')
 assert.equal(root.querySelector('[aria-selected=true]').dataset.stage,'adaptation_plan')
 assert.equal(root.querySelector('[data-stage=source_analysis]'),null)
 assert.equal(root.querySelector('.production-project-nav').children.length,1)
 assert.equal(root.querySelector('.production-project-nav').firstElementChild.dataset.stage,'project')
 assert.equal(JSON.stringify(p),before)
})
test('隐藏解析的完成和失败不计入制作进度，原稿入口继续可用',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_hidden_stage',name:'隐藏阶段'})
 p.node_states.source_analysis.status='confirmed'
 const view=createProjectDocumentView(root,{project:p,executionStates:{source_analysis:{status:'failed',reason:'后台解析失败'}}});t.after(()=>view.dispose())
 assert.equal(root.querySelector('.production-progress').textContent,'已完成 0 / 9')
 assert.equal(root.querySelector('[data-stage=source_analysis]'),null)
 root.querySelector('[data-stage=project]').click()
 assert.ok(root.querySelector('.project-script-import'))
 assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='编辑短剧信息'))
})
test('分片编排展示程序执行按钮，隐藏AI规则和修订，保留人工编辑及历史',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_program_ui',name:'程序原文'});p.node_states.clip_arrangement.product_revision=1
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'clip_arrangement'},request:async()=>({})});t.after(()=>view.dispose());const labels=[...root.querySelectorAll('button')].map(b=>b.textContent);assert.ok(labels.includes('执行本步骤'));assert.ok(labels.includes('人工编辑产物'));assert.ok(labels.includes('任务历史'));for(const text of ['查看规则','编辑补充规则','生成/重新生成','按意见修改现有产物'])assert.equal(labels.includes(text),false)
})

test('联合改编中文展示精简团队指导，人工编辑保留ID与版本',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_groups',name:'团队展示'});let saved
 p.adaptation_plan.group_plans=[{id:'guard',name:'营地守卫队',social_role:'守卫营地',description:'保持共同组织形象，面容各异'}]
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 const card=root.querySelector('[data-guidance-group=group_plans] .production-card');assert.match(card.textContent,/团队规划/);assert.match(card.textContent,/营地守卫队/);assert.match(card.textContent,/身份：守卫营地/);assert.doesNotMatch(card.textContent,/costumes|segment_plans|social_role/)
 ;[...card.querySelectorAll('button')].find(b=>b.textContent==='编辑此项').click();root.querySelector('[aria-label="描述"]').value='共同灰甲，成员面容各异'
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick()
 assert.equal(saved.value.group_plans[0].description,'共同灰甲，成员面容各异');assert.equal(saved.value.group_plans[0].id,'guard');assert.equal(saved.expected_revision,0)
})

test('剧情发展按全篇纯文本展示和编辑，保留人物团队场景及版本',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_global',name:'全篇指导'});let saved
 p.adaptation_plan={...makePlan({development:'主角争取支持，经历公开论证后获得附带条件的通过。',character_plans:[{id:'cp_a',name:'主角',description:'探索者',motivation:'争取支持',relationships:'与委员会冲突',arc:'坚定'}],scene_plans:[{id:'sp_a',name:'会议厅',function:'公开论证',description:'圆桌会议厅'}],group_plans:[{id:'gp_a',name:'委员会',social_role:'审议',description:'评估计划'}]}),revision:1,source_revision_id:null}
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 assert.deepEqual([...root.querySelectorAll('.production-guidance-group h3')].map(e=>e.textContent),['全篇创作约束','剧情发展','人物规划','团队规划','场景规划'])
 const plot=root.querySelector('[data-guidance-group=plot_development]');assert.match(plot.textContent,/主角争取支持/);assert.equal(plot.querySelectorAll('.production-card').length,1)
 assert.doesNotMatch(plot.textContent,/sequence|character_|scene_|group_|chapter_|事件ID|标题：/)
 ;[...plot.querySelectorAll('button')].find(b=>b.textContent==='编辑剧情发展').click()
 const text=root.querySelector('dialog textarea');assert.equal(text.value,p.adaptation_plan.plot_development);text.value='主角通过辩论获得支持，附带条件引出新的风险。'
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick()
 assert.equal(saved.value.plot_development,text.value);assert.deepEqual(saved.value.character_plans,p.adaptation_plan.character_plans);assert.equal(saved.expected_revision,0)
})

test('空团队规划始终展示卡片和占位文字',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_no_group',name:'个人冒险'})
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'}});t.after(()=>view.dispose())
 const group=root.querySelector('[data-guidance-group=group_plans]');assert.ok(group);assert.match(group.querySelector('h3').textContent,/团队规划/)
 assert.equal(group.querySelectorAll('.production-card').length,1);assert.equal(group.querySelector('.production-card').textContent,'暂无团队规划。');assert.deepEqual(p.adaptation_plan.group_plans,[])
})

test('全篇创作约束独立编辑，保留剧情事件和人物规划',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_constraints',name:'科学冒险'});p.adaptation_plan={...p.adaptation_plan,...makePlan({direction:'科学冒险'})};let saved
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 ;[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑全篇创作约束').click()
 const text=root.querySelector('dialog textarea'),value=JSON.parse(text.value);value.audience='成年观众';text.value=JSON.stringify(value)
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick()
 assert.equal(saved.value.creative_constraints.audience,'成年观众');assert.deepEqual(saved.value.plot_development,p.adaptation_plan.plot_development);assert.equal(saved.expected_revision,0)
})

test('故事定稿卡直接展示分页后的完整正文与换行，隐藏路径并可编辑保存',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_story',name:'正文展示'}),text='甲：出发。\n'+ '完整剧情。'.repeat(4000)+'\n<script>仅作为剧本文字</script>\n故事结束。',requests=[]
 p.story_segments.segments=[{id:'s1',sequence:1,revision:1,adaptation_revision:0,title:'第一段',body_ref:'artifacts/story.txt',continuity_ref:'artifacts/continuity.txt'}]
 let command
 const request=async path=>{const url=new URL(path,'http://test/');requests.push(url);const start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));return {body:text.slice(start,end),characters:text.length,end:Math.min(end,text.length)}}
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'story_segments'},request,save:async value=>{command=value;return p}});t.after(()=>view.dispose())
 await tick();assert.equal(root.querySelector('.production-card .production-text').textContent,text);assert.equal(requests.length,2)
 assert.doesNotMatch(root.textContent,/artifacts\/|body_ref|continuity_ref/);assert.equal(root.querySelector('.production-card script'),null)
 const before=requests.length;view.update(p);await tick();assert.equal(requests.length,before,'相同不可变正文不重复请求')
 const edit=[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑正文');edit.click();await tick();assert.equal(root.querySelector('dialog textarea').value,text)
 root.querySelector('dialog textarea').value='修改后的完整正文';await [...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').onclick()
 assert.equal(command.kind,'artifact_text');assert.equal(command.ref,'artifacts/story.txt');assert.equal(command.value,'修改后的完整正文')
})

test('故事正文更新引用后显示新文字，迟到的旧请求不覆盖当前卡片',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_story',name:'实时更新'})
 p.story_segments.segments=[{id:'s1',sequence:1,revision:1,adaptation_revision:0,title:'第一段',body_ref:'artifacts/old.txt',continuity_ref:null}]
 let oldResponse
 const request=async path=>new URL(path,'http://test/').searchParams.get('ref')==='artifacts/old.txt'?await new Promise(resolve=>{oldResponse=resolve}):{body:'新改编正文\n新结局',characters:10}
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'story_segments'},request});t.after(()=>view.dispose())
 const next=structuredClone(p);next.story_segments.segments[0].body_ref='artifacts/new.txt';view.update(next);await tick();assert.match(root.textContent,/新改编正文\n新结局/)
 oldResponse({body:'旧正文',characters:3});await tick();assert.doesNotMatch(root.textContent,/旧正文/);assert.match(root.textContent,/新结局/)
})

test('故事正文读取失败可直接重试，不暴露底层路径',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_story',name:'失败重试'});let attempts=0
 p.story_segments.segments=[{id:'s1',sequence:1,revision:1,adaptation_revision:0,title:'第一段',body_ref:'artifacts/story.txt',continuity_ref:null}]
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'story_segments'},request:async()=>{if(!attempts++)throw new Error('ENOENT /private/storage/artifacts/story.txt');return {body:'重试取得的完整正文',characters:10}}});t.after(()=>view.dispose())
 await tick();assert.match(root.textContent,/正文加载失败/);assert.doesNotMatch(root.textContent,/private\/|artifacts\//)
 const retry=[...root.querySelectorAll('button')].find(b=>b.textContent==='重试加载正文');await retry.onclick();assert.match(root.textContent,/重试取得的完整正文/);assert.doesNotMatch(root.textContent,/正文加载失败/)
})

function shotListProject(){
 const p=createProjectDocument({id:'p_shot_list',name:'分镜列表'})
 p.story_segments.segments=[{id:'seg_private_one',sequence:1,revision:1,adaptation_revision:0,title:'准备出发',body_ref:'artifacts/one.txt',continuity_ref:null},{id:'seg_private_two',sequence:2,revision:1,adaptation_revision:0,title:'平原集结',body_ref:'artifacts/two.txt',continuity_ref:null}]
 const asset=(id,name)=>({id,name,description:'用于故事的稳定定义',image_ids:[],selected_image_id:null})
 p.asset_library.characters=[{...asset('character_private','巴比堪'),character_plan_id:null,voice_profile:{description:'低沉',reference_audio_ref:null,revision:0}}]
 p.asset_library.scenes=[{...asset('scene_private_one','炮旁准备区'),scene_plan_id:null,layout:'开阔',entrances:'栅门',landmarks:'炮口'},{...asset('scene_private_two','发射地平原与临时观礼城'),scene_plan_id:null,layout:'平原',entrances:'道路',landmarks:'观礼台'}]
 const shot=(sequence,segment,scene)=>({id:'shot_private_'+sequence,sequence,revision:1,story_segment_id:segment,story_segment_revision:1,scene_id:scene,characters:[{character_id:'character_private',look_id:null,opening_state:'站在场中'}],props:[],reference_images:[],beats:[{id:'beat_private_'+sequence,duration_seconds:6,action:'巴比堪走向炮口。',camera:'缓慢推进的近景',scene_changes:'人群退开',effects:'扬尘',dialogues:[{id:'line_private_'+sequence,speaker_id:'character_private',text:'准备出发！',delivery:{emotion:'坚定',volume:'低',pace:'平稳',breath:'均匀'}}],soundscape:'风声',music:'低弦乐'}]})
 p.shot_design.shots=[shot(2,'seg_private_two','scene_private_two'),shot(1,'seg_private_one','scene_private_one')]
 p.asset_requirements.items=[{id:'req_private_one',kind:'scene',target_id:'scene_private_one',shot_ids:['shot_private_1'],strategy:'import',status:'pending',image_id:null},{id:'req_private_two',kind:'scene',target_id:'scene_private_two',shot_ids:['shot_private_2'],strategy:'generate',status:'pending',image_id:null}]
 return p
}

test('文字分镜按故事段及镜头排序，直接展示声画和人物名称且不混入素材需求',t=>{
 const {root}=fixture(t),p=shotListProject(),before=JSON.stringify(p),view=createProjectDocumentView(root,{project:p,state:{documentStage:'shot_design'}});t.after(()=>view.dispose())
 const groups=[...root.querySelectorAll('.production-shot-group')]
 assert.equal(groups.length,2);assert.match(groups[0].querySelector('summary').textContent,/故事第 1 段 · 准备出发/);assert.match(groups[1].querySelector('summary').textContent,/故事第 2 段 · 平原集结/)
 assert.match(root.querySelector('.production-shot-summary').textContent,/2 个故事段 · 2 个镜头 · 预计 12 秒/)
 assert.match(groups[0].textContent,/镜头 01 · 炮旁准备区/);assert.match(groups[1].textContent,/镜头 02 · 发射地平原与临时观礼城/)
 for(const text of ['巴比堪','准备出发！','缓慢推进的近景','风声','低弦乐','情绪：坚定'])assert.ok(root.textContent.includes(text))
 assert.doesNotMatch(root.textContent,/req_private|scene_private|shot_private|character_private|beat_private|line_private|revision|target_id|pending|artifacts\//)
 assert.equal(root.querySelectorAll('.production-shot-card').length,2);assert.equal(root.querySelectorAll('.production-asset-status').length,0);assert.equal(JSON.stringify(p),before,'展示不修改数据排序或内容')
})

test('分镜列表可按名称编辑场景、开场状态、节拍和对白，保存保留稳定ID及版本检查',async t=>{
 const {root}=fixture(t);let p=shotListProject(),command
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'shot_design'},save:async value=>{command=value;p=editProjectProduct(p,value.stage,value.value,{expectedRevision:value.expected_revision});return p}});t.after(()=>view.dispose())
 const click=label=>[...root.querySelectorAll('button')].find(b=>b.textContent===label).click()
 const save=async()=>[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').onclick()
 click('编辑镜头');const select=root.querySelector('dialog [aria-label=场景]');assert.equal(select.tagName,'SELECT');assert.match(select.textContent,/炮旁准备区/);select.value='scene_private_two';root.querySelector('dialog [aria-label="人物 1（巴比堪）开场状态"]').value='转向观礼台';await save()
 assert.equal(command.expected_revision,0);assert.equal(command.value.shot_design.shots.find(s=>s.sequence===1).scene_id,'scene_private_two');assert.equal(command.value.shot_design.shots.find(s=>s.sequence===1).characters[0].opening_state,'转向观礼台')
 click('编辑动作与声画');root.querySelector('dialog [aria-label=动作]').value='巴比堪停步，望向观礼台。';root.querySelector('dialog [aria-label="时长（秒）"]').value='8';await save()
 assert.equal(command.expected_revision,1);const beat=command.value.shot_design.shots.find(s=>s.sequence===1).beats[0];assert.equal(beat.id,'beat_private_1');assert.equal(beat.duration_seconds,8);assert.equal(beat.action,'巴比堪停步，望向观礼台。')
 click('编辑对白');root.querySelector('dialog [aria-label=对白原文]').value='我们准备好了。';root.querySelector('dialog [aria-label=情绪]').value='平静';await save()
 assert.equal(command.expected_revision,2);const line=command.value.shot_design.shots.find(s=>s.sequence===1).beats[0].dialogues[0];assert.equal(line.id,'line_private_1');assert.equal(line.text,'我们准备好了。');assert.equal(line.delivery.emotion,'平静')
})

test('素材准备按类型展示用途和中文状态，图片占位与生成导入入口保持可用',async t=>{
 const {root}=fixture(t),p=shotListProject();let submitted
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'asset_preparation'},request:async(path,options)=>{if(path.startsWith('production/')){submitted=JSON.parse(options.body);return {group_id:'group_test'}}return {project:p}}});t.after(()=>view.dispose())
 assert.deepEqual([...root.querySelectorAll('.production-asset-group')].map(g=>g.dataset.assetKind),['characters','scenes','clothing','props','character_looks'])
 const scenes=[...root.querySelectorAll('[data-asset-kind=scenes] .asset-work-card')]
 assert.match(scenes[0].textContent,/场景图 · 待导入/);assert.match(scenes[1].textContent,/场景图 · 待生成/);assert.match(scenes[1].textContent,/用于：故事第 2 段 · 镜头 02/);assert.match(scenes[1].textContent,/暂无图片/)
 assert.doesNotMatch(root.textContent,/req_private|target_id|shot_private|pending|strategy/)
 assert.ok([...scenes[1].querySelectorAll('button')].some(b=>b.textContent==='导入并选用图片'));[...scenes[1].querySelectorAll('button')].find(b=>b.textContent==='AI生成此素材').click();await tick();assert.equal(submitted.target_id,'scene_private_two')
 const next=structuredClone(p);next.asset_library.scenes[1].image_ids=['img_selected'];next.asset_library.scenes[1].selected_image_id='img_selected';view.update(next)
 const selected=root.querySelector('[data-asset-id=scene_private_two]');assert.match(selected.textContent,/场景图 · 已选用/);assert.equal(selected.querySelector('img').alt,'发射地平原与临时观礼城候选');assert.doesNotMatch(selected.textContent,/暂无图片/)
})

test('素材候选点击放大、Escape关闭且不选图，切换步骤清理预览遮罩',async t=>{
 const {dom,root}=fixture(t),p=shotListProject();let commands=0
 p.asset_library.scenes[0].image_ids=['img_big']
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'asset_preparation'},save:async()=>{commands++;return p}});t.after(()=>view.dispose())
 const preview=root.querySelector('[data-asset-id=scene_private_one] .production-image-thumbnail');assert.equal(preview.tagName,'BUTTON');assert.match(preview.getAttribute('aria-label'),/放大查看/);preview.click();await tick()
 const dialog=root.querySelector('.production-image-preview');assert.ok(dialog.open);assert.match(dialog.querySelector('img').src,/\/api\/drama\/images\/img_big$/);assert.equal(dialog.querySelector('img').alt,'炮旁准备区候选');assert.equal(dialog.querySelector('a').target,'_blank');assert.equal(commands,0)
 dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.querySelector('.production-image-preview'),null);assert.equal(root.querySelector('.panel-dialog-overlay'),null)
 preview.click();await tick();[...root.querySelectorAll('.production-image-preview button')].find(b=>b.textContent==='关闭').click();assert.equal(root.querySelector('.production-image-preview'),null)
 preview.click();await tick();root.querySelector('[data-stage=shot_design]').click();assert.equal(root.querySelector('.production-image-preview'),null);assert.equal(root.querySelector('.panel-dialog-overlay'),null);assert.equal(commands,0)
})

test('选图库支持嵌套大图预览，关闭预览保留图库，只有选用按钮修改素材',async t=>{
 const {dom,root}=fixture(t),p=shotListProject();let command
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'asset_preparation'},request:async()=>({total:1,items:[{id:'img_library',url:'/api/drama/images/img_library'}]}),save:async value=>{command=value;return p}});t.after(()=>view.dispose())
 const card=root.querySelector('[data-asset-id=scene_private_one]');[...card.querySelectorAll('button')].find(b=>b.textContent==='从图片库选用').click();await tick()
 const gallery=root.querySelector('.production-gallery');gallery.querySelector('.production-image-thumbnail').click();await tick();assert.equal(root.querySelectorAll('.panel-dialog-overlay').length,2);assert.equal(command,undefined)
 dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.querySelector('.production-image-preview'),null);assert.ok(gallery.open);assert.equal(root.querySelectorAll('.panel-dialog-overlay').length,1)
 await [...gallery.querySelectorAll('button')].find(b=>b.textContent==='选用此图').onclick();assert.equal(command.kind,'image_select');assert.equal(command.target_id,'scene_private_one');assert.equal(command.image_id,'img_library');assert.equal(root.querySelector('.production-gallery'),null);assert.equal(root.querySelector('.panel-dialog-overlay'),null)
})

test('素材图片生成成功的阶段直接显示已通过，不再提供人工审核确认入口',t=>{
 const {root}=fixture(t),p=shotListProject();p.node_states.asset_preparation.status='confirmed';p.node_states.asset_preparation.reason='素材图片已准备完成'
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'asset_preparation'}});t.after(()=>view.dispose())
 assert.equal(root.querySelector('.production-section .node-data-tag').textContent,'已通过');assert.equal(root.querySelector('[data-stage=asset_preparation]').dataset.tone,'complete')
 assert.equal([...root.querySelectorAll('button')].some(button=>button.textContent==='人工检查确认'),false)
 root.querySelector('[data-stage=story_segments]').click();assert.ok([...root.querySelectorAll('button')].some(button=>button.textContent==='人工检查确认'),'其他阶段确认入口保持原样')
})
