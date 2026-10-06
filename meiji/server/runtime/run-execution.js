import { assertDrama } from '../../shared/drama-model.js'
import { runRecordStore, runStore } from '../data/run-store.js'
import { readProjectFile } from '../data/project-files.js'
import { loadSkillSet } from '../data/skill-store.js'
import { addBaselines } from '../data/content-records.js'

export async function startRunExecution(home, run, step, operation) {
  const project = assertDrama(await readProjectFile(home, run.projectId))
  let skillSet = run.skillSnapshot
  if (!skillSet) {
    skillSet = await loadSkillSet(home, project.skills)
    skillSet.nodeSupplements = structuredClone(Object.fromEntries(project.episodes.map(episode => [episode.id, episode.supplementalSkills || {}])))
    await runStore(home, run.projectId).update(run.id, current => { current.skillSnapshot ||= skillSet; return current })
  }
  const store = runRecordStore(home, run.projectId, run.id, step.id), baselines = new Map()
  const stage = ['outline', 'characters', 'scenes'].includes(step.target) ? 'story' : step.target?.split(':')[0]
  await addBaselines(store, project, operation, stage, baselines)
  const node = { ...step, scope: 'root', prompts: [], responses: [], attempts: [], inputs: [], outputs: [] }
  return { runId: run.id, stepId: step.id, store, home, projectId: run.projectId, actor: step.actor, operation,
    stage, baselines, outputs: [], nodes: [node], nodeId: step.id, scope: 'root', skillSet, skills: new Map() }
}
