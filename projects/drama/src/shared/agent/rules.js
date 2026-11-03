import {readFile} from 'node:fs/promises'
import {nodeRuleFile} from '../nodes/node_rule_files.js'
import {projectStages} from '../production/production_stages.js'

export const textStages=projectStages.filter(stage=>stage.kind==='ai').map(stage=>stage.id)
export const skillPath=(stage,action)=>nodeRuleFile(stage,action)
export async function actionRules(stage,action,custom=''){return (await readFile(skillPath(stage,action),'utf8'))+(custom?`\n\n## 项目定制规则（优先）\n${custom}`:'')}
