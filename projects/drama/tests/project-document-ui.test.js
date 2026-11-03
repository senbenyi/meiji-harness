import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {projectDialog} from '../src/node_box/project/ui/panel/project-forms.js'
import {createProjectDocumentView} from '../src/client/project-document-view.js'
import {createProjectDocument,editProjectProduct} from '../src/project_runtime/project_document.js'
const tick=()=>new Promise(r=>setImmediate(r))
function fixture(t){const dom=new JSDOM('<main/>'),previous=globalThis.document;dom.window.HTMLDialogElement.prototype.show=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()});return {dom,root:document.querySelector('main')}}
test('新文档左侧12步骤，键盘切换且每一步提供编辑或原稿导入',t=>{
 const {dom,root}=fixture(t),p=createProjectDocument({id:'p_ui',name:'新流程'}),view=createProjectDocumentView(root,{project:p,save:async()=>p,request:async()=>({body:''})});t.after(()=>view.dispose())
 assert.equal(root.querySelector('[role=tablist]').getAttribute('aria-orientation'),'vertical');assert.equal(root.querySelectorAll('[role=tab]').length,12)
 for(const tab of root.querySelectorAll('[role=tab]')){tab.click();assert.ok([...root.querySelectorAll('button')].some(b=>/人工编辑产物|本地导入/.test(b.textContent)))}
 root.querySelector('[data-stage=project]').click();root.querySelector('[aria-selected=true]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(root.querySelector('[aria-selected=true]').dataset.stage,'source_analysis')
})
test('产物编辑保存携带原版本，失败保留输入且不会修改只读规则',async t=>{
 const {root}=fixture(t);let p=createProjectDocument({id:'p_ui',name:'编辑'}),command,fail=true
 const state={documentStage:'adaptation_plan'},view=createProjectDocumentView(root,{project:p,state,request:async()=>({}),save:async c=>{command=c;if(fail)throw new Error('编辑冲突');p=editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision});return p}});t.after(()=>view.dispose())
 const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click()
 click('人工编辑产物');const input=root.querySelector('dialog textarea');input.value=JSON.stringify({...p.adaptation_plan,goal:'人工目标'});click('保存');await tick();assert.match(root.querySelector('dialog').textContent,/编辑冲突/);assert.match(input.value,/人工目标/)
 fail=false;click('保存');await tick();assert.equal(root.querySelector('dialog'),null);assert.equal(command.expected_revision,0);assert.match(root.textContent,/人工目标/);assert.match(root.textContent,/待核对/)
 click('查看规则');assert.equal(root.querySelector('textarea').readOnly,true);assert.equal([...root.querySelectorAll('dialog button')].some(b=>b.textContent==='保存'),false)
})

test('流程状态依据完成、未通过和真实失败，候选/取消不当完成，更新同步导航与标题',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_flow',name:'流程状态'});p.node_states.project.status='confirmed';p.node_states.source_analysis.status='rejected';p.node_states.adaptation_plan.status='draft';p.node_states.story_segments.status='confirmed';p.node_states.story_segments.last_execution={task_id:'failed',status:'failed',reason:'模型连接失败'};p.node_states.shot_design.last_execution={task_id:'cancelled',status:'cancelled',reason:'用户停止'}
 const state={documentStage:'story_segments'},view=createProjectDocumentView(root,{project:p,state});t.after(()=>view.dispose());const tab=id=>root.querySelector(`[role=tab][data-stage=${id}]`)
 assert.equal(tab('project').dataset.tone,'complete');assert.equal(tab('source_analysis').dataset.tone,'error');assert.equal(tab('adaptation_plan').dataset.tone,'pending');assert.match(tab('adaptation_plan').textContent,/待核对/);assert.equal(tab('story_segments').dataset.tone,'error');assert.match(tab('shot_design').textContent,/已停止/);assert.match(root.querySelector('.production-progress').textContent,/1 \/ 12/);assert.equal(root.querySelector('.production-section').dataset.tone,'error');assert.match(root.querySelector('[role=status]').textContent,/模型连接失败/)
 const next=structuredClone(p);next.node_states.story_segments.status='confirmed';next.node_states.story_segments.last_execution.status='done';view.update(next);assert.equal(tab('story_segments').dataset.tone,'complete');assert.match(root.querySelector('.production-section .node-data-tag').textContent,/已完成/);assert.match(root.querySelector('.production-progress').textContent,/2 \/ 12/)
})

test('活动执行优先于旧失败，不把执行中染为完成或错误',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_active',name:'运行状态'});p.node_states.source_analysis.status='partial';p.node_states.source_analysis.last_execution={task_id:'old',status:'failed',reason:'上次失败'}
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},sessionId:'session',request:async()=>({project:p,active_execution:{group:{id:'active'},task:{node_type:'source_analysis',metadata:{production:true}}}})});t.after(()=>view.dispose());await tick();const tab=root.querySelector('[data-stage=source_analysis]');assert.equal(tab.dataset.running,'true');assert.equal(tab.dataset.tone,'pending');assert.match(tab.textContent,/执行中/);assert.match(root.querySelector('.production-section .node-data-tag').textContent,/执行中/)
})

test('短剧信息在短剧与原稿编辑，删除在顶部工具末尾，版本和意见保留',async t=>{
 const {dom,root}=fixture(t);let p=createProjectDocument({id:'p_layout',name:'入口调整'}),saved,removed=0;const state={documentStage:'delivery'},view=createProjectDocumentView(root,{project:p,state,remove:()=>removed++,request:async()=>({}),save:async c=>{saved=c;p={...p,basic_info:{...p.basic_info,...c.value}};return p}});t.after(()=>view.dispose());const buttons=label=>[...root.querySelectorAll('button')].filter(b=>b.textContent===label),click=label=>buttons(label)[0].click()
 assert.equal(buttons('编辑短剧信息').length,0);assert.equal(buttons('删除短剧').length,1);assert.equal(root.querySelectorAll('.production-project-tools button').length,3);assert.equal(root.querySelector('.production-project-tools').lastElementChild.textContent,'删除短剧');assert.equal(buttons('执行本步骤').length,0);assert.equal(buttons('按设置分集并导出').length,1)
 root.querySelector('[data-stage=source_analysis]').click();assert.equal(root.querySelector('.node-ui-execution button').textContent,'执行本步骤');const opinion=root.querySelector('.node-ui-opinion');opinion.value='尊重原著，保留对白';opinion.dispatchEvent(new dom.window.Event('input'));root.querySelector('[data-stage=project]').click();assert.equal(buttons('编辑短剧信息').length,1);assert.equal(root.querySelector('.production-project-header').textContent.includes('编辑短剧信息'),false);click('编辑短剧信息');assert.equal(root.querySelector('dialog textarea'),null);const input=root.querySelector('dialog [name=title]');input.value='新标题';await root.querySelector('dialog form').onsubmit({preventDefault(){}});await tick();assert.equal(saved.kind,'basic_info');assert.equal(saved.expected_revision,0);assert.match(root.querySelector('.production-project-header h2').textContent,/新标题/);assert.equal(removed,0);click('删除短剧');assert.equal(removed,1);root.querySelector('[data-stage=source_analysis]').click();assert.equal(root.querySelector('.node-ui-opinion').value,'尊重原著，保留对白')
})


test('短剧编辑复用旧字段弹框，失败保留输入/自定义语言，取消和销毁清理遮罩',async t=>{
 const {root}=fixture(t);let p=createProjectDocument({id:'p_form',name:'旧标题',output_language:'fr'}),command,fail=true;p.node_states.project.product_revision=4
 const view=createProjectDocumentView(root,{project:p,save:async value=>{command=value;if(fail)throw new Error('版本冲突，请刷新');p={...p,basic_info:{...p.basic_info,...value.value}};return p}});t.after(()=>view.dispose());const edit=()=>[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑短剧信息').click()
 edit();let dialog=root.querySelector('dialog');assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('textarea'),null);assert.equal(dialog.querySelector('[name=id]'),null);assert.equal(dialog.querySelector('[name=reference_episode_duration_seconds]'),null);assert.equal(dialog.querySelector('[name=output_language]'),null);dialog.querySelector('[name=title]').value='保留输入';dialog.querySelector('[name=aspect]').value='16:9';dialog.querySelector('[name=mode]').value='free';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(dialog.open,true);assert.match(dialog.querySelector('[role=alert]').textContent,/版本冲突/);assert.equal(dialog.querySelector('[name=title]').value,'保留输入');assert.equal(command.expected_revision,4)
 fail=false;await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(root.querySelector('dialog'),null);assert.equal(p.basic_info.output_language,'fr');assert.equal(p.basic_info.id,'p_form');assert.equal(p.basic_info.creation_mode,'自由创作');assert.equal(p.basic_info.aspect_ratio,'16:9');assert.equal(root.querySelector('.panel-dialog-overlay'),null)
 edit();[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='取消').click();assert.equal(root.querySelector('.panel-dialog-overlay'),null);edit();view.dispose();assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})

test('添加短剧保持原创建弹框与导入字段，不要求填写JSON',async t=>{
 const {root}=fixture(t);let submitted;const dialog=projectDialog(root,async fields=>{submitted=fields},{maxScriptBytes:24*1024*1024});assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('textarea'),null);assert.equal(dialog.querySelector('#project-mode').value,'script');dialog.querySelector('#title').value='新增短剧';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.match(dialog.querySelector('[role=alert]').textContent,/导入或选择剧本/);assert.equal(submitted,undefined)
 const file=dialog.querySelector('input[type=file]');Object.defineProperty(file,'files',{value:[{name:'原稿.txt',size:12,text:async()=> '第一章：张飞进入营帐。'}],configurable:true});await file.onchange();dialog.querySelector('#aspect').value='16:9';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(submitted.basic_info.name,'新增短剧');assert.equal(submitted.basic_info.aspect_ratio,'16:9');assert.equal(submitted.basic_info.original_script_filename,'原稿.txt');assert.equal(submitted.basic_info.original_script,'第一章：张飞进入营帐。');assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})

test('编辑与添加共用创建表单，回填当前原稿且不读正文，换稿随资料一次提交',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_shared',name:'已有短剧',output_language:'fr'});p.source={current_revision_id:'src_old',revisions:[{id:'src_old',file_ref:'sources/old.txt',original_name:'旧稿.txt',character_count:10000000,line_index_ref:null}]};let command;const requests=[]
 const view=createProjectDocumentView(root,{project:p,request:async path=>{requests.push(path);if(path==='library')return {assets:[{id:'script_one',category:'scripts',originalName:'素材新稿.txt'}]};if(path==='library/scripts/script_one')return {body:'新的完整原稿'};throw Error('不应读取旧原稿')},save:async value=>{command=value;return p}});t.after(()=>view.dispose());[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑短剧信息').click();const dialog=root.querySelector('dialog');assert.ok(dialog.querySelector('form.create'));assert.equal(dialog.querySelector('[name=title]').value,'已有短剧');assert.match(dialog.querySelector('.script-selected').textContent,/旧稿.txt/);assert.equal(requests.length,0);assert.equal(dialog.querySelector('textarea'),null)
 await dialog.querySelector('.script-choose').onclick();const picker=dialog.querySelector('.script-picker');picker.value='script_one';await picker.onchange();dialog.querySelector('[name=title]').value='新资料';await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(command.kind,'basic_info');assert.equal(command.value.output_language,'fr');assert.equal(command.value.name,'新资料');assert.deepEqual(command.source,{text:'新的完整原稿',original_name:'素材新稿.txt'});assert.equal(command.expected_revision,0);assert.equal(root.querySelector('dialog'),null)
})

test('原稿页仅本地与素材库导入，库导入带版本；切换后迟到读取不提交',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_imports',name:'双入口'});let command,release,held=false;const state={};const view=createProjectDocumentView(root,{project:p,state,request:async path=>path==='library'?{assets:[{id:'script',category:'scripts',originalName:'素材.txt'}]}:held?new Promise(resolve=>{release=()=>resolve({body:'迟到原稿'})}):{body:'库原稿'},save:async value=>{command=value;return p}});t.after(()=>view.dispose());assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='导入/修改原稿'),false);assert.equal(root.querySelector('textarea'),null)
 let choose=root.querySelector('.project-script-import .script-choose');assert.equal(choose.textContent,'素材库导入');assert.equal(root.querySelector('.project-script-import .script-import').textContent,'本地导入');await choose.onclick();let picker=root.querySelector('.script-picker');picker.value='script';await picker.onchange();assert.equal(command.kind,'import_script');assert.equal(command.originalName,'素材.txt');assert.equal(command.value,'库原稿');assert.equal(command.expected_revision,0)
 command=null;held=true;await root.querySelector('.script-choose').onclick();picker=root.querySelector('.script-picker');picker.value='script';const reading=picker.onchange();root.querySelector('[data-stage=source_analysis]').click();release();await reading;assert.equal(command,null)
})

test('活动任务冲突只属于触发节点，任务结束后轮询清理且未开始节点不受影响',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_conflict',name:'冲突清理'});p.node_states.source_analysis.status='confirmed';let poll,active={group:{id:'busy'},task:{node_type:'story_segments',metadata:{production:true}}}
 t.mock.method(globalThis,'setInterval',callback=>{poll=callback;return {}});t.mock.method(globalThis,'clearInterval',()=>{})
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},request:async path=>{if(path==='project')return {project:p,active_execution:active};throw new Error('短剧已有执行任务')}});t.after(()=>view.dispose())
 const notice=()=>root.querySelector('.node-ui-failure'),generate=()=>[...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick()
 await generate();assert.equal(notice().textContent,'短剧已有执行任务');assert.match(root.querySelector('.node-data-tag').textContent,/已完成/)
 root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(notice().hidden,true);root.querySelector('[data-stage=source_analysis]').click();assert.equal(notice().textContent,'短剧已有执行任务')
 active=null;poll();await tick();assert.equal(notice().hidden,true);assert.match(root.querySelector('.node-data-tag').textContent,/已完成/);root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(notice().hidden,true)
})

test('冲突响应迟到但刷新已无活动任务时立即清理，不依赖partial状态',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_done',name:'已结束'});p.node_states.source_analysis.status='confirmed';let reads=0
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},request:async path=>{if(path==='project'){reads++;return {project:p,active_execution:null}}throw new Error('短剧已有执行任务')}});t.after(()=>view.dispose())
 await [...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick();assert.equal(reads,1);assert.equal(root.querySelector('.node-ui-failure').hidden,true)
})

test('迟到执行错误归原节点，普通错误刷新不丢，重试成功后清理并保留真实历史失败',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_late',name:'迟到错误'});let reject,fail=true
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},request:async path=>path==='project'?{project:p,active_execution:null}:fail?new Promise((_,no)=>{reject=no}):{group_id:'success'}});t.after(()=>view.dispose())
 const generate=()=>[...root.querySelectorAll('button')].find(b=>/^(生成\/重新生成|执行本步骤)$/.test(b.textContent)).onclick(),pending=generate();await tick();root.querySelector('[data-stage=adaptation_plan]').click();reject(new Error('模型连接失败'));await pending;assert.equal(root.querySelector('.node-ui-failure').hidden,true)
 root.querySelector('[data-stage=source_analysis]').click();assert.equal(root.querySelector('.node-ui-failure').textContent,'模型连接失败');view.update(structuredClone(p));assert.equal(root.querySelector('.node-ui-failure').textContent,'模型连接失败')
 fail=false;await generate();assert.equal(root.querySelector('.node-ui-failure').hidden,true)
 const failed=structuredClone(p);failed.node_states.source_analysis.last_execution={task_id:'failed',status:'failed',reason:'供应商返回真实失败'};view.update(failed);assert.equal(root.querySelector('.node-ui-failure').textContent,'供应商返回真实失败')
})

test('仅真实执行中的当前节点显示加载圆环，结束隐藏受理提示并保留失败原因',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_spinner',name:'加载状态'});p.node_states.source_analysis.status='partial';p.node_states.source_analysis.reason='任务已受理';let poll,active={group:{id:'working'},task:{node_type:'source_analysis',metadata:{production:true}}}
 t.mock.method(globalThis,'setInterval',callback=>{poll=callback;return {}});t.mock.method(globalThis,'clearInterval',()=>{})
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},sessionId:'session',request:async()=>({project:p,active_execution:active})});t.after(()=>view.dispose());await tick()
 const notice=()=>root.querySelector('.node-ui-failure');assert.equal(notice().getAttribute('aria-label'),'执行中');assert.equal(notice().getAttribute('aria-busy'),'true');assert.ok(notice().querySelector('.original-summary-loading'));assert.equal(notice().textContent,'');assert.equal(notice().hidden,false)
 root.querySelector('[data-stage=adaptation_plan]').click();assert.equal(root.querySelector('.original-summary-loading'),null);assert.equal(notice().hidden,true);root.querySelector('[data-stage=source_analysis]').click();assert.ok(notice().querySelector('.original-summary-loading'))
 active=null;p.node_states.source_analysis.status='confirmed';poll();await tick();assert.equal(root.querySelector('.original-summary-loading'),null);assert.equal(notice().hidden,true);assert.equal(notice().hasAttribute('aria-busy'),false)
 p.node_states.source_analysis.last_execution={task_id:'failed',status:'failed',reason:'审核未通过'};view.update(p);assert.equal(notice().textContent,'审核未通过');assert.equal(notice().hidden,false)
})

test('联合改编约束按完整文本列表展示，实体编辑保留且空列表不生成卡片',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_requirements',name:'完整约束'});p.adaptation_plan.locked_requirements=['本单元覆盖原稿0—1200字符。','保留原著人物关系与关键对白。'];p.adaptation_plan.character_plans=[{id:'cp_one',name:'张飞',description:'勇猛',motivation:'迎战',relationships:'对峙',arc:'坚守'}];p.node_states.adaptation_plan.product_revision=3;let saved
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async command=>{saved=command;return p}});t.after(()=>view.dispose());let cards=[...root.querySelectorAll('.production-card')],requirements=cards.find(card=>card.querySelector('h4').textContent==='改编约束');assert.ok(requirements);assert.match(requirements.textContent,/1\. 本单元覆盖原稿0—1200字符。/);assert.match(requirements.textContent,/2\. 保留原著人物关系与关键对白。/);assert.doesNotMatch(requirements.textContent,/locked_requirements|0：本|1：单/)
 const character=cards.find(card=>card.querySelector('h4').textContent==='张飞');assert.ok(character);[...character.querySelectorAll('button')].find(button=>button.textContent==='编辑此项').click();root.querySelector('dialog [aria-label=描述]').value='勇猛忠诚';await [...root.querySelectorAll('dialog button')].find(button=>button.textContent==='保存').onclick();assert.equal(saved.kind,'product');assert.equal(saved.stage,'adaptation_plan');assert.equal(saved.expected_revision,3);assert.equal(saved.value.character_plans[0].description,'勇猛忠诚');assert.deepEqual(saved.value.locked_requirements,p.adaptation_plan.locked_requirements)
 const empty=createProjectDocument({id:'p_empty',name:'无产物'});view.update(empty);assert.equal(root.querySelectorAll('.production-card').length,0);assert.match(root.querySelector('.production-empty').textContent,/暂无联合改编规划产物/)
})

test('原著分段正文可查看和编辑，页面不再提供来源范围控件',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_body',name:'正文分段'});p.source_analysis.chapters=[{id:'chapter',sequence:1,title:'第一段',body:'完整原文😀。',summary:'辅助摘要'}];let command
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},save:async value=>{command=value;return p}});t.after(()=>view.dispose());let buttons=[...root.querySelectorAll('button')];assert.equal(buttons.some(b=>b.textContent==='编辑章节边界'),false);buttons.find(b=>b.textContent.startsWith('查看正文')).click();assert.equal(root.querySelector('dialog textarea').value,'完整原文😀。');assert.equal(root.querySelector('dialog textarea').readOnly,true);[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='关闭').click();[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑此项').click();assert.equal(root.querySelector('dialog [aria-label=正文]').value,'完整原文😀。');root.querySelector('dialog [aria-label=标题]').value='新标题';await [...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').onclick();assert.equal(command.value.chapters[0].body,'完整原文😀。');assert.equal(command.value.chapters[0].title,'新标题');assert.equal(Object.hasOwn(command.value.chapters[0],'source_spans'),false)
})

test('原著解析仅展示分段，内部事实/覆盖报告不展示或编辑，保存章节时原样保留',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_internal',name:'内部报告'});p.source_analysis={source_revision_id:'src',chapters:[{id:'c1',sequence:1,title:'原稿分段',body:'完整正文',summary:'摘要'}],facts_ref:'artifacts/facts.json',coverage_ref:'artifacts/coverage.json'};let command
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},save:async value=>{command=value;return p}});t.after(()=>view.dispose());assert.equal(root.querySelectorAll('.production-card').length,1);assert.doesNotMatch(root.textContent,/原著事实|覆盖报告|facts_ref|coverage_ref|artifacts\//);assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent.startsWith('查看正文')));assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='编辑正文'),false)
 const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click();click('人工编辑产物');const textarea=root.querySelector('dialog textarea'),value=JSON.parse(textarea.value);assert.deepEqual(Object.keys(value),['chapters']);assert.doesNotMatch(root.querySelector('dialog').textContent,/\$text/);value.chapters[0].title='新的分段标题';value.facts_ref='artifacts/overwrite.json';textarea.value=JSON.stringify(value);await [...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').onclick();assert.equal(command.value.chapters[0].title,'新的分段标题');assert.equal(command.value.source_revision_id,'src');assert.equal(command.value.facts_ref,'artifacts/facts.json');assert.equal(command.value.coverage_ref,'artifacts/coverage.json')
 const empty=structuredClone(p);empty.source_analysis.chapters=[];view.update(empty);assert.equal(root.querySelectorAll('.production-card').length,0);assert.match(root.querySelector('.production-empty').textContent,/暂无原著解析产物/)
 empty.adaptation_plan.plot_text='保留主线，强化人物动机';view.update(empty);root.querySelector('[data-stage=adaptation_plan]').click();assert.match(root.textContent,/全篇改编指导/);assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='编辑全篇指导'))
})

test('原著解析展示程序执行按钮，隐藏AI规则和修订，保留人工编辑及历史',t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_program_ui',name:'程序原文'});p.source_analysis.chapters=[{id:'c',sequence:1,title:'原稿',body:'正文',summary:''}];p.node_states.source_analysis.product_revision=1
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'source_analysis'},request:async()=>({})});t.after(()=>view.dispose());const labels=[...root.querySelectorAll('button')].map(b=>b.textContent);assert.ok(labels.includes('执行本步骤'));assert.ok(labels.includes('人工编辑产物'));assert.ok(labels.includes('任务历史'));for(const text of ['查看规则','编辑补充规则','生成/重新生成','按意见修改现有产物'])assert.equal(labels.includes(text),false)
})

test('联合改编中文展示精简团队指导，人工编辑保留ID与版本',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_groups',name:'团队展示'});let saved
 p.adaptation_plan.group_plans=[{id:'guard',name:'营地守卫队',social_role:'守卫营地',description:'保持共同组织形象，面容各异'}]
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 const card=root.querySelector('.production-card');assert.match(card.textContent,/团队指导/);assert.match(card.textContent,/营地守卫队/);assert.match(card.textContent,/身份：守卫营地/);assert.doesNotMatch(card.textContent,/costumes|segment_plans|social_role/)
 ;[...card.querySelectorAll('button')].find(b=>b.textContent==='编辑此项').click();root.querySelector('[aria-label="描述"]').value='共同灰甲，成员面容各异'
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick()
 assert.equal(saved.value.group_plans[0].description,'共同灰甲，成员面容各异');assert.equal(saved.value.group_plans[0].id,'guard');assert.equal(saved.expected_revision,0)
})

test('全篇改编指导直接展示和弹框编辑，不显示旧剧情文件或段计划',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_global',name:'全篇指导'});let saved;p.adaptation_plan.plot_text='保持主线，以人物动机增强冲突'
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 assert.match(root.textContent,/全篇改编指导/);assert.match(root.textContent,/以人物动机增强冲突/);assert.doesNotMatch(root.textContent,/故事分段规划|plot_plan_ref/)
 ;[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑全篇指导').click();root.querySelector('[aria-label="全篇改编指导"]').value='保留原著主题，合并重复冲突'
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick();assert.equal(saved.value.plot_text,'保留原著主题，合并重复冲突');assert.equal(Object.hasOwn(saved.value,'segment_plans'),false)
})

test('短剧名占位目标提示补充五项原则，编辑仍保留其他产物和版本',async t=>{
 const {root}=fixture(t),p=createProjectDocument({id:'p_principles',name:'月界旅行4'});p.adaptation_plan.goal=p.basic_info.name;p.adaptation_plan.plot_text='保留主线';let saved
 const view=createProjectDocumentView(root,{project:p,state:{documentStage:'adaptation_plan'},save:async c=>{saved=c;return editProjectProduct(p,c.stage,c.value,{expectedRevision:c.expected_revision})}});t.after(()=>view.dispose())
 assert.match(root.textContent,/改编目标与原则/);assert.match(root.textContent,/当前内容只有短剧名称/);assert.match(root.textContent,/风格、受众、改编尺度、保留和允许调整/)
 ;[...root.querySelectorAll('button')].find(b=>b.textContent==='编辑目标与原则').click();root.querySelector('[aria-label="改编目标与原则"]').value='风格：科学冒险；受众：待确认；尺度：适度改编；保留：科学精神；允许调整：重复对话'
 ;[...root.querySelectorAll('dialog button')].find(b=>b.textContent==='保存').click();await tick();assert.equal(saved.value.plot_text,'保留主线');assert.match(saved.value.goal,/风格：科学冒险/);assert.equal(saved.expected_revision,0);assert.doesNotMatch(root.textContent,/当前内容只有短剧名称/)
})
