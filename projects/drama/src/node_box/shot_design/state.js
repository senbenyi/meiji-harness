import { NodeStateModel } from '@agent-modules/task/models'
import { validateNodeOutput, parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import shotDefinition from './definition.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { digest } from '../script_revision/state.js'
export { digest }
// 仅接收阶段允许空团队ID，以便清理无语义占位；写入前仍使用原始严格契约。
const intakeDefinition = structuredClone(shotDefinition)
delete intakeDefinition.output.properties.shots.items.properties.groups.items.properties.group_id.minLength
export function parseShotCandidate(response, scope) {
  return validateShotCandidate(parseNodeOutput('shot_design', 'generate', response, { definition: { shot_design: intakeDefinition } }), scope)
}
const groupFields = ['group_id','costume_id','presence','position','facing','gaze_target']
function cleanEmptyGroups(value) {
  const copy = structuredClone(value)
  if (Array.isArray(copy?.shots)) for (const shot of copy.shots) if (Array.isArray(shot?.groups)) {
    shot.groups = shot.groups.filter(row => !(row && Object.keys(row).length === groupFields.length && groupFields.every(key => typeof row[key] === 'string' && !row[key].trim())))
  }
  return copy
}
export const shotOutput = project => ({ shots: structuredClone(project.shot_design.shots) })
export const shotCharacters = project => ({ characters: structuredClone(project.character_extraction.characters),
  costume_references: (project.character_extraction.assets || []).flatMap(asset => (asset.costume_images || [])
    .filter(image => image.address && image.node_state.status === 'generated')
    .map(image => ({ character_id: asset.character_id, costume_id: image.costume_id }))) })
export const shotFingerprint = project => digest({ segments: project.story_segments.segments, outline_status: project.story_segments.node_state.status,
  upstream: ['scene_extraction','group_setting','character_extraction'].map(type => ({ type, status: project[type].node_state.status,
    output: type === 'scene_extraction' ? project[type].scenes : type === 'group_setting' ? project[type].groups : shotCharacters(project) })), rules: nodeRules(project.shot_design.node_state) })

export function validateShotCandidate(value, { story_outline, scene_extraction, group_setting, character_extraction, allowEmpty = false } = {}) {
  const output = validateNodeOutput('shot_design', 'generate', cleanEmptyGroups(value))
  if (!output.shots.length && !allowEmpty) throw new TypeError('分镜集合不能为空')
  const segments = story_outline?.segments, segmentMap = segments && new Map(segments.map((row,i)=>[row.id,{...row,index:i}]))
  const scenes = scene_extraction && new Set(scene_extraction.scenes.map(row=>row.id))
  const groups = group_setting && new Map(group_setting.groups.map(row=>[row.id,row]))
  const characters = character_extraction && new Map(character_extraction.characters.map(row=>[row.id,row]))
  const ids = new Set(), coveredSegments = new Set(), coveredAnchors = new Set(), lastCostumes = new Map(); let previousSegment = -1
  const unique = (values,label) => { if(new Set(values).size!==values.length) throw new TypeError(`${label}重复`) }
  const costume = (owner,id,segmentId,label) => {
    if (!id) { if(owner?.costumes?.length) throw new TypeError(`${label}需选择服装`);return }
    const row = owner?.costumes?.find(row=>row.id===id)
    if (!row) throw new TypeError(`${label}服装引用无效：${id}`)
    if (label === '团队' && row.story_segment_ids?.length && !row.story_segment_ids.includes(segmentId)) throw new TypeError(`${label}服装不适用于本故事段：${id}`)
  }
  for (const [index,shot] of output.shots.entries()) {
    if (ids.has(shot.id)) throw new TypeError(`镜头ID重复：${shot.id}`); ids.add(shot.id)
    if ((index===0)!==(shot.previous_shot_connection==='opening')) throw new TypeError('仅第一镜使用opening，后镜需continuous或cut')
    const segment = segmentMap?.get(shot.story_segment_id)
    if (segmentMap) {
      if (!segment) throw new TypeError(`镜头引用不存在的故事段：${shot.story_segment_id}`)
      if (segment.index < previousSegment) throw new TypeError('镜头故事段顺序倒置')
      previousSegment=segment.index; coveredSegments.add(segment.id)
    }
    unique(shot.key_anchor_ids,'镜头锚点')
    for (const id of shot.key_anchor_ids) {
      if (segment && !segment.key_anchors.some(row=>row.id===id)) throw new TypeError(`镜头锚点不属于当前故事段：${id}`)
      coveredAnchors.add(id)
    }
    if (scenes && shot.scene.scene_id && !scenes.has(shot.scene.scene_id)) throw new TypeError(`场景引用不存在：${shot.scene.scene_id}`)
    unique(shot.groups.map(row=>row.group_id),'镜头团队')
    for (const row of shot.groups) if(groups) {
      const group=groups.get(row.group_id);if(!group) throw new TypeError(`团队引用不存在：${row.group_id}`)
      costume(group,row.costume_id,shot.story_segment_id,'团队')
    }
    unique(shot.characters.filter(row=>row.character_id).map(row=>row.character_id),'镜头人物')
    for (const row of shot.characters) if(characters) {
      if(!row.character_id) { if(row.costume_id) throw new TypeError('无人物ID不能引用个人服装');continue }
      const character=characters.get(row.character_id);if(!character) throw new TypeError(`人物引用不存在：${row.character_id}`)
      if (!row.costume_id && character.costumes?.length) {
        const known = new Set(character.costumes.map(costume => costume.id))
        const references = [...new Set((character_extraction.costume_references || []).filter(ref => ref.character_id === row.character_id && known.has(ref.costume_id)).map(ref => ref.costume_id))]
        row.costume_id = lastCostumes.get(row.character_id) || (references.length === 1 ? references[0] : character.costumes.length === 1 ? character.costumes[0].id : '')
        if (!row.costume_id) throw new TypeError(`镜头 ${shot.id}：人物 ${row.name} 有多套服装，请明确沿用的定妆服装ID`)
      }
      costume(character,row.costume_id,shot.story_segment_id,'人物')
      if (row.costume_id) lastCostumes.set(row.character_id,row.costume_id)
    }
    for(const beat of shot.beats) if(!beat.action.trim()) throw new TypeError('每个节拍需描述动作')
    if(!shot.beats[0].camera.trim()) throw new TypeError('首拍需建立摄影构图')
  }
  if (segments && !allowEmpty) for (const segment of segments) {
    if(!coveredSegments.has(segment.id)) throw new TypeError(`分镜遗漏故事段：${segment.id}`)
    for(const anchor of segment.key_anchors) if(!coveredAnchors.has(anchor.id)) throw new TypeError(`分镜遗漏关键锚点：${anchor.id}`)
  }
  return output
}
export function expireShotDependents(project) {
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if(value.node_state && value.node_state.status!=='empty') value.node_state = new NodeStateModel({...value.node_state,status:'expired',reason:'分镜资料或规则已变化，需重新生成'}).toJSON()
    for(const [key,child] of Object.entries(value)) if(!['node_state','rules'].includes(key)) visit(child)
  }
  for(const key of ['clip_arrangement','video_prompt','videos','episodes']) visit(project[key])
}
