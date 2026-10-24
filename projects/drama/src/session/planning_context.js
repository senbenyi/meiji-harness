import { shotOutput } from '../node_box/shot_design/state.js'
import { scriptOutput, nodeRules, nodeState } from '../node_runtime/node_state.js'
import { sceneOutput } from '../node_box/scene_extraction/state.js'
import { groupOutput } from '../node_box/group_setting/state.js'
import { characterOutput } from '../node_box/character_extraction/state.js'
import { boxReport } from '../node_runtime/box_report.js'

const dependencies = {
  project: [], script_revision: ['project'], story_segments: ['project', 'script_revision'],
  group_setting: ['story_segments'], character_extraction: ['story_segments', 'group_setting'], scene_extraction: ['story_segments'],
  costume_image: ['group_setting', 'character_extraction'], scene_image: ['scene_extraction'],
  shot_design: ['story_segments', 'scene_extraction', 'group_setting', 'character_extraction'],
  clip_arrangement: ['shot_design'], video_prompt: ['clip_arrangement', 'shot_design', 'costume_image', 'scene_image'],
  videos: ['video_prompt'], episodes: ['videos'],
}

/** 依赖和过期状态由代码提供；执行顺序和修复位置交主Agent判断。 */
export function dependencyFacts(project) {
  return Object.entries(dependencies).map(([node_type, upstream]) => ({ node_type, upstream,
    executable: ['project', 'script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'costume_image', 'shot_design'].includes(node_type),
    state: node_type === 'project' ? 'ready' : nodeState(project, node_type)?.status || 'empty',
  }))
}

export async function planningContext(projects, records, { sessionId, reportId }) {
  const { project } = await projects.snapshot(sessionId)
  if (!project) throw Object.assign(new Error('当前会话没有项目'), { code: 'PROJECT_SCOPE' })
  let report = null
  if (reportId) {
    const detail = records.tasks.detail(records.scope, reportId)
    if (!detail || boxReport(detail).session_id !== sessionId || detail.tasks[0].metadata.project_id !== project.basic_info.id)
      throw Object.assign(new Error('报告不属于当前项目会话'), { code: 'PROJECT_SCOPE' })
    report = boxReport(detail)
  }
  return { project_id: project.basic_info.id, report, dependencies: dependencyFacts(project),
    project: { basic_info: project.basic_info },
    script_revision: { output: scriptOutput(project), rules: nodeRules(project.basic_info.script_revision_node),
      node_state: project.basic_info.script_revision_node, opinion: project.basic_info.script_revision_node.opinion },
    story_segments: { output: { segments: project.story_segments.segments }, rules: nodeRules(project.story_segments.node_state),
      node_state: project.story_segments.node_state, opinion: project.story_segments.node_state.opinion },
    scene_extraction: { output: sceneOutput(project), rules: nodeRules(project.scene_extraction.node_state), node_state: project.scene_extraction.node_state },
    group_setting: { output: groupOutput(project), rules: nodeRules(project.group_setting.node_state), node_state: project.group_setting.node_state },
    character_extraction: { output: characterOutput(project), rules: nodeRules(project.character_extraction.node_state), node_state: project.character_extraction.node_state },
    shot_design: { output: shotOutput(project), rules: nodeRules(project.shot_design.node_state), node_state: project.shot_design.node_state },
    executable_boxes: ['project', 'script_revision', 'story_segments', 'scene_extraction', 'group_setting', 'character_extraction', 'costume_image', 'shot_design'],
  }
}

/** 创建新项目时只交接真实用户的目标，不复制整份源会话或模型推测。 */
export function latestUserGoal(agent) {
  const events = agent?.session?.snapshotEvents?.() || []
  const message = events.findLast(event => event.type === 'user/message' && event.data?.source?.kind === 'user')?.data
  return message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '创建项目'
}
