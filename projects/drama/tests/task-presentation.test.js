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

test('当前任务输入依赖仅展示当次冻结引用，不用现短剧或重建模型输入',()=>{
 const task={node_type:'adaptation_plan',metadata:{document_version:2,project_id:'p',input_ref:'artifacts/frozen.json',input_snapshot:{rules:'不得重建'}}};const original=structuredClone(task);assert.deepEqual(dependencies(task,[]),{project_id:'p',payload_ref:'artifacts/frozen.json'});assert.deepEqual(task,original)
})
test('当前输出取最后完成步骤，执行中不冒充交付，失败保留已保存步骤',()=>{
 const steps=[{step_status:'done',result:{candidate_ref:'artifacts/candidate.json',saved:true}},{step_status:'failed',result:{error:'失败'}}];const output=taskHistoryPresentation.taskOutput;for(const status of ['queued','running'])assert.deepEqual(output({task_status:status},steps),{result:null});for(const status of ['completed','failed','rejected','cancelled'])assert.deepEqual(output({task_status:status},steps),{result:steps[0].result});assert.deepEqual(output({task_status:'failed'},[]),{result:null})
})
