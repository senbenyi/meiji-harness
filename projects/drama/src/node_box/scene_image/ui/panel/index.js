import { element } from '../../../../client/ui/panel-dom.js'
const button = (text, action) => { const node=element('button',text);node.type='button';node.onclick=action;return node }
export function renderSceneImage(root, scene, project, {state, sceneImages: operation={}, busy=false}) {
  state.sceneImageUi ||= {};const image=project.scene_extraction.assets?.find(row=>row.scene_id===scene.id)?.image_generation
  const local=state.sceneImageUi[scene.id] ||= {instruction:image?.node_state.opinion||'',reference:image?.reference_image||'',savedInstruction:image?.node_state.opinion||'',savedReference:image?.reference_image||'',error:'',chain:Promise.resolve()}
  const active=['queued','running'].includes(operation.execution?.status)?operation.execution:null
  const blocked=!!busy || !!active || !!state.sceneImageSubmitting || !!local.saving
  const box=element('section','','scene-image-controls');box.dataset.sceneId=scene.id
  box.append(element('h5','场景图'))
  const input=element('textarea','','scene-image-instruction');input.value=local.instruction;input.placeholder='本次生图要求（可选）';input.maxLength=10000;input.disabled=blocked
  input.setAttribute('aria-label',`${scene.name}生图要求`);input.oninput=()=>{local.instruction=input.value}
  const error=element('p',local.error,'error');error.setAttribute('role','status')
  const persist=()=>{
    const instruction=local.instruction,reference=local.reference
    const save=async()=>{
      if(instruction===local.savedInstruction && reference===local.savedReference)return
      if(!operation.saveInputs)throw new Error('场景图输入保存入口不可用')
      if(!operation.isCurrent?.())throw new Error('会话已切换')
      local.saving=true
      try {await operation.saveInputs({scene_id:scene.id,instruction,reference_image:reference,previous_instruction:local.savedInstruction,previous_reference_image:local.savedReference})
        local.savedInstruction=instruction;local.savedReference=reference;local.error=''
      } finally{local.saving=false}
    }
    const pending=local.chain.catch(()=>{}).then(save);local.chain=pending;return pending
  }
  const report=failure=>{local.error=failure.message;if(operation.isCurrent?.())operation.repaint?.()}
  input.onblur=()=>{void persist().catch(report)}
  box.append(input)
  const strip=element('div','','scene-image-strip'),referenceBox=element('div','','scene-image-reference'),resultBox=element('div','','scene-image-result')
  referenceBox.append(element('p','参考图','production-meta'));resultBox.append(element('p','结果图','production-meta'))
  const reference=element('div','','scene-image-reference-frame')
  if(local.reference){const img=element('img');img.src=local.reference;img.alt=`${scene.name}的参考图`;reference.append(img)}else reference.textContent='未添加'
  referenceBox.append(reference)
  const file=element('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.hidden=true;file.disabled=blocked;file.setAttribute('aria-label',`${scene.name}上传参考图`)
  file.onchange=async()=>{
    const selected=file.files?.[0];if(!selected||blocked)return
    if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>8*1024*1024){report(new Error('请选择不超过8MB的PNG、JPEG或WebP图片'));return}
    try{
      const value=await new Promise((resolve,reject)=>{const reader=new root.ownerDocument.defaultView.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('参考图读取失败'));reader.readAsDataURL(selected)})
      if(!operation.isCurrent?.())return
      local.reference=value;operation.repaint?.();await persist();operation.refresh?.()
    }catch(failure){report(failure)}
  }
  const upload=button(local.reference?'更换参考图':'添加参考图',()=>file.click());upload.disabled=blocked||!operation.saveInputs
  referenceBox.append(upload,file)
  if(local.reference){const remove=button('移除',async()=>{if(remove.disabled)return;local.reference='';operation.repaint?.();try{await persist();operation.refresh?.()}catch(failure){report(failure)}});remove.disabled=blocked;referenceBox.append(remove)}
  const frame=element(image?.address?'a':'div','','scene-image-result-frame');frame.style.aspectRatio=(image?.aspect_ratio||project.basic_info.aspect_ratio||'16:9').replace(':','/')
  if(image?.address){frame.href=image.address;frame.target='_blank';frame.rel='noopener';frame.title='查看场景图原图';const img=element('img');img.src=image.address;img.alt=`${scene.name}的场景图`;img.loading='lazy';frame.append(img)}else frame.textContent='暂无场景图'
  resultBox.append(frame);strip.append(referenceBox,resultBox);box.append(strip)
  const run=button(image?.address?'重新生成':'生成场景图',async()=>{
    if(run.disabled||state.sceneImageSubmitting||!operation.isCurrent?.())return
    state.sceneImageSubmitting=scene.id;local.error=''
    const instruction=local.instruction.trim()||`生成${scene.name}的无人场景总览图`
    const signature=JSON.stringify({instruction,reference:local.reference})
    if(local.request?.signature!==signature)local.request={signature,id:root.ownerDocument.defaultView.crypto.randomUUID()}
    operation.repaint?.()
    try{await persist();const result=await operation.generate({scene_id:scene.id,instruction},local.request.id)
      if(!operation.isCurrent())return
      local.request=null;operation.setExecution({...result,scene_id:scene.id});operation.refresh?.()
    }catch(failure){report(failure)}finally{state.sceneImageSubmitting=null;if(operation.isCurrent?.())operation.repaint?.()}
  })
  run.disabled=blocked||!operation.generate||project.scene_extraction.node_state.status!=='generated'
  run.title=project.scene_extraction.node_state.status!=='generated'?'请先完成场景提取':blocked?'项目任务正在执行':'按场景资料、要求和参考图生成'
  box.append(run)
  if(active?.scene_id===scene.id || state.sceneImageSubmitting===scene.id){const text=element('p',state.sceneImageSubmitting===scene.id?'正在提交场景图任务…':active.status==='queued'?'场景图排队中…':'正在生成场景图…','scene-image-progress');text.setAttribute('role','status');text.setAttribute('aria-live','polite');box.append(text)}
  else if(image?.node_state.last_execution && ['failed','cancelled','rejected'].includes(image.node_state.last_execution.status))box.append(element('p',image.node_state.last_execution.message,'error'))
  if(image?.address&&image.node_state.status==='expired')box.append(element('p','场景或输入已变化，图片已过期','production-meta'))
  box.append(error);root.append(box)
}
