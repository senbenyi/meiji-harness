import {readFile} from 'node:fs/promises'

const names={generate:'generate.md',review:'review.md',revise:'revise.md',output:'output-format.json'}
export function nodeRuleFile(node,action){
 if(typeof node!=='string'||!/^[a-z][a-z0-9_]*$/.test(node)||!Object.hasOwn(names,action))throw new TypeError('节点或规则动作无效')
 return new URL(node==='memory_maintenance'?`../../memory/skills/${node}-${names[action]}`:`../../node_box/${node}/skills/${node}-${names[action]}`,import.meta.url)
}
export async function readNodeRule(node,action){return readFile(nodeRuleFile(node,action),'utf8')}
export async function readNodeFormat(node){return JSON.parse(await readNodeRule(node,'output'))}
