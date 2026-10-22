import test from 'node:test'
import assert from 'node:assert/strict'
import {taskHistoryPresentation} from '../src/client/ui/task-presentation.js'
import { JSDOM } from 'jsdom'
import { createTaskHistory } from '@agent-modules/task/ui'
import { styles } from '../../../packages/task/ui/styles.js'
const dependencies=taskHistoryPresentation.inputDependencies

test('审核未通过按业务结论投影，保留原执行状态并排除通过/执行异常',()=>{
  for(const status of ['content_issue','upstream_issue','rule_conflict']) {
    const step={kind:'review',step_status:'done',result:{review:{status,issues:[{location:'actual_script',reason:'内容矛盾',suggestion:'修正动作'}]}}}
    const before=structuredClone(step),value=taskHistoryPresentation.review(step)
    assert.equal(value.rejected,true);assert.match(value.reason,/actual_script：内容矛盾；修正动作/)
    assert.deepEqual(step,before)
    for(const step_status of ['running','failed','cancelled'])assert.deepEqual(taskHistoryPresentation.review({...step,step_status}),{})
  }
  assert.deepEqual(taskHistoryPresentation.review({kind:'review',step_status:'done',result:{review:{status:'passed',issues:[]}}}),{})
  assert.deepEqual(taskHistoryPresentation.review({kind:'generate',step_status:'done'}),{})
})

test('公共任务卡片将done但审核有问题的步骤显示为红色未通过',async t=>{
  const dom=new JSDOM('<main/>')
  const task={id:'task',group_id:'group',group_seq:1,node_type:'script_revision',name:'剧本优化',task_status:'completed',metadata:{}}
  const step={id:'review',task_id:'task',seq:1,kind:'review',name:'剧本本地审核',executor:'ai',step_status:'done',result:{review:{status:'content_issue',issues:[{reason:'动作冲突',suggestion:'修正动作'}]}}}
  const detail={group:{id:'group',name:'剧本优化'},tasks:[task],steps:[step],status:'completed'}
  const ui=createTaskHistory({document:dom.window.document,presentation:taskHistoryPresentation,
    initialView:{groupId:'group'},source:{history:async()=>({groups:[detail],total:1}),detail:async()=>detail}})
  t.after(()=>{ui.dispose();dom.window.close()})
  await ui.ready
  const root=ui.element.shadowRoot
  const card=root.querySelector('[data-step-id="review"]')
  assert.ok(card)
  assert.equal(card.querySelector('.task-history-status').textContent,'未通过')
  assert.ok(card.querySelector('.task-history-status').classList.contains('is-rejected'))
  assert.ok(card.classList.contains('is-failed'))
  assert.match(card.textContent,/未通过原因.*动作冲突；修正动作/)
  const palette=new JSDOM(`<style>${styles}</style><span class="task-history-status is-rejected">未通过</span>`)
  assert.equal(palette.window.getComputedStyle(palette.window.document.querySelector('span')).color,'rgb(241, 170, 170)')
  palette.window.close()
})

test('剧本输入依赖优先历史真实输入，只展示外部入参，规则保留在内部记录',()=>{
  const task={node_type:'script_revision',metadata:{project_id:'project',notify_main:true,language:'zh-CN',instruction:'本次目标',input_snapshot:{original_script:'提交原稿',rules:{saved:true}}}}
  const steps=[{prompt:{input:{original_script:'实际原稿',current_script:{body:'实际旧稿'},creative_requirements:'创作要求',rules:{internal:true},review_issues:['内部审核'],steps:['内部步骤'],instruction:'实际目标',output_language:'zh-CN'}}}]
  const before=structuredClone({task,steps}),value=dependencies(task,steps)
  assert.equal(value.instruction,'实际目标');assert.equal(value.original_script,'实际原稿');assert.deepEqual(value.current_script,{body:'实际旧稿'});assert.equal(Object.hasOwn(value,'rules'),false)
  assert.equal(Object.hasOwn(value,'creative_requirements'),false);assert.equal(Object.hasOwn(value,'reference_episode_duration_seconds'),false)
  assert.equal(Object.hasOwn(value,'project_id'),false);assert.equal(Object.hasOwn(value,'notify_main'),false)
  assert.equal(Object.hasOwn(value,'review_issues'),false);assert.equal(Object.hasOwn(value,'steps'),false)
  assert.deepEqual({task,steps},before)
  const explicit={node_type:'script_revision',metadata:{input_dependencies:{original_script:'显式原稿',rules:{internal:true},review_issues:['内部问题']}}}
  assert.deepEqual(dependencies(explicit,[]),{original_script:'显式原稿'})
  assert.deepEqual(dependencies(task,[]),{original_script:'提交原稿',instruction:'本次目标',output_language:'zh-CN'})
  assert.equal(dependencies({metadata:{}},[]),null)
  assert.equal(dependencies({node_type:'future_box',metadata:{input_snapshot:{rules:'内部规则'}}},[]),null)
})

test('项目盒子输入显示创建资料或导入命令，不展示内部命令或摘要子步骤名',()=>{
  assert.deepEqual(dependencies({node_type:'project',metadata:{info:{name:'新项目'}}},[]),{basic_info:{name:'新项目'}})
  assert.deepEqual(dependencies({node_type:'project',metadata:{command:{kind:'import_script',value:'新稿'}}},[{prompt:{input:{original_script:'新稿'}}}]),{original_script:'新稿'})
})

const output=taskHistoryPresentation.taskOutput
const task=(status,node_type='script_revision',metadata={})=>({task_status:status,node_type,metadata})
const generated=(seq,body)=>({seq,kind:'revise',step_status:'done',result:{output:{body,summary:'摘要',estimated_duration_seconds:20}}})
const reviewed=(seq,status)=>({seq,kind:'review',step_status:status==='passed'?'done':'rejected',result:{review:{status,issues:[{reason:'上游矛盾',suggestion:'修改上游资料'}]}}})

test('剧本输出取最终通过稿，失败交付原因依据与候选；运行中不冒充交付',()=>{
  const steps=[generated(1,'第一稿'),reviewed(2,'content_issue'),generated(3,'最终稿'),reviewed(4,'passed')]
  const before=structuredClone(steps)
  assert.equal(output(task('completed'),steps).result.body,'最终稿')
  assert.equal(output(task('completed'),steps).decision,'passed')
  assert.equal(Object.hasOwn(output(task('completed'),steps),'partial_result'),false)
  for(const status of ['rejected','failed','cancelled']) {
    const value=output(task(status),[generated(1,'未通过稿'),reviewed(2,'upstream_issue')])
    assert.equal(value.result,null);assert.equal(value.partial_result.output.body,'未通过稿')
    assert.match(value.partial_result.label,/候选/);assert.equal(value.issues[0].suggestion,'修改上游资料')
    if(status==='rejected')assert.equal(value.decision,'upstream_issue')
  }
  for(const status of ['queued','running'])assert.deepEqual(output(task(status),steps),{result:null})
  assert.deepEqual(output(task('failed'),[]),{decision:'failed',result:null})
  assert.equal(output(task('failed'),[...steps.slice(0,3),{seq:4,kind:'review',step_status:'failed'}]).issues,undefined,'新稿不能沿用旧稿审核意见')
  assert.deepEqual(steps,before)
})

test('项目输出合并创建与摘要，摘要失败显示警告，取消保留部分成果，规则修改只展示实际完成字段',()=>{
  const created={project_id:'p',session_id:'s',workspace:{id:'w'}}
  const steps=[{kind:'create',step_status:'done',result:{created}},{kind:'extract_summary',step_status:'done',result:{output:{summary:'摘要',estimated_duration_seconds:90}}}]
  const before=structuredClone(steps)
  assert.deepEqual(output(task('completed','project'),steps),{result:{...created,output:{summary:'摘要',estimated_duration_seconds:90}}})
  const cancelled=output(task('cancelled','project'),steps)
  assert.equal(cancelled.result,null);assert.equal(cancelled.partial_result.output.project_id,'p')
  const warned=output(task('completed','project'),[steps[0],{kind:'extract_summary',step_status:'done',result:{summary_error:'摘要失败'}}])
  assert.equal(warned.warning,'摘要失败');assert.equal(warned.result.project_id,'p')
  assert.deepEqual(output(task('completed','project',{command:{kind:'import_script',value:'导入稿',previousValue:'旧稿'}}),[{kind:'import_script',step_status:'done',result:{changed:true}}]),{result:{changed:true,original_script:'导入稿'}})
  const ruleTask=task('completed','script_rules',{patch:{action:'review',field:'base',value:'新规则',previous_value:'旧规则'},input_hash:'内部'})
  assert.deepEqual(output(ruleTask,[{step_status:'done',result:{changed:true}}]),{result:{changed:true,action:'review',field:'base',value:'新规则'}})
  assert.deepEqual(output({...ruleTask,task_status:'failed'},[]),{result:null})
  assert.deepEqual(output(task('completed','unknown'),[{step_status:'done',result:{review_packet:{rules:'内部'}}}]),{result:null})
  assert.deepEqual(steps,before)
})
