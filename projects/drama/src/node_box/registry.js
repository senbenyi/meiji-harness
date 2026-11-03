import {confirm as deliveryConfirm} from './delivery/runtime/confirm.js'
import {confirm as video_renderConfirm} from './video_render/runtime/confirm.js'
import {confirm as video_promptConfirm} from './video_prompt/runtime/confirm.js'
import {confirm as reference_bindingConfirm} from './reference_binding/runtime/confirm.js'
import {confirm as asset_preparationConfirm} from './asset_preparation/runtime/confirm.js'
import {confirm as editingConfirm} from './editing/runtime/confirm.js'
import {confirm as clip_arrangementConfirm} from './clip_arrangement/runtime/confirm.js'
import {confirm as shot_designConfirm} from './shot_design/runtime/confirm.js'
import {confirm as story_segmentsConfirm} from './story_segments/runtime/confirm.js'
import {confirm as adaptation_planConfirm} from './adaptation_plan/runtime/confirm.js'
import {confirm as source_analysisConfirm} from './source_analysis/runtime/confirm.js'
import {manual as editingManual} from './editing/runtime/manual.js'
import {manual as video_renderManual} from './video_render/runtime/manual.js'
import {manual as asset_preparationManual} from './asset_preparation/runtime/manual.js'
import {projectStages} from '../shared/production/production_stages.js'
import * as adaptation_planPipeline from './adaptation_plan/runtime/pipeline.js'
import * as story_segmentsPipeline from './story_segments/runtime/pipeline.js'
import * as story_segmentsExecution from './story_segments/runtime/execution.js'
import * as shot_designPipeline from './shot_design/runtime/pipeline.js'
import * as video_promptPipeline from './video_prompt/runtime/pipeline.js'
import {executeUnit as source_analysisExecute} from './source_analysis/runtime/execute.js'
import {executeUnit as reference_bindingExecute} from './reference_binding/runtime/execute.js'
import {executeUnit as clip_arrangementExecute} from './clip_arrangement/runtime/execute.js'
import {executeUnit as editingExecute} from './editing/runtime/execute.js'
import {executeUnit as deliveryExecute} from './delivery/runtime/execute.js'
export const nodeBoxes=Object.freeze({
 project:{id:'project',type:'program'},
 adaptation_plan:{id:'adaptation_plan',confirm:adaptation_planConfirm,type:'text',pipeline:adaptation_planPipeline},
 story_segments:{id:'story_segments',confirm:story_segmentsConfirm,type:'text',pipeline:{...story_segmentsPipeline,...story_segmentsExecution}},
 shot_design:{id:'shot_design',confirm:shot_designConfirm,type:'text',pipeline:shot_designPipeline},
 video_prompt:{id:'video_prompt',confirm:video_promptConfirm,type:'text',pipeline:video_promptPipeline},
 source_analysis:{id:'source_analysis',confirm:source_analysisConfirm,type:'program',execute:source_analysisExecute},
 reference_binding:{id:'reference_binding',confirm:reference_bindingConfirm,type:'program',execute:reference_bindingExecute},
 clip_arrangement:{id:'clip_arrangement',confirm:clip_arrangementConfirm,type:'program',execute:clip_arrangementExecute},
 editing:{id:'editing',manual:editingManual,confirm:editingConfirm,type:'program',execute:editingExecute},
 delivery:{id:'delivery',confirm:deliveryConfirm,type:'program',execute:deliveryExecute},
 asset_preparation:{id:'asset_preparation',manual:asset_preparationManual,confirm:asset_preparationConfirm,type:'image'},
 video_render:{id:'video_render',manual:video_renderManual,confirm:video_renderConfirm,type:'video'}
})
if(projectStages.length!==Object.keys(nodeBoxes).length||projectStages.some(stage=>!nodeBoxes[stage.id]))throw new TypeError('制作盒子与阶段目录不一致')

export function manualStage(command){if(['image_import','image_select','voice_extract'].includes(command.kind)||command.kind==='audio_import'&&command.role!=='track')return 'asset_preparation';if(['video_import','video_select','video_reject'].includes(command.kind))return 'video_render';if(command.kind==='regenerate_subtitles'||command.kind==='audio_import'&&command.role==='track')return 'editing';return null}
