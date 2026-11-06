import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir,readFile,access,mkdtemp,cp,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {nodeRuleFile,readNodeRule,readNodeFormat} from '../src/shared/nodes/node_rule_files.js'
import {actionRules,textStages} from '../src/node_box/shared/agent/rules.js'
import {outputContract,reviewContract} from '../src/node_box/shared/agent/contracts.js'
import {projectDocumentSchema} from '../src/drama_runtime/drama_document.js'

test('6个制作规则节点skills内直接放四份文件，根目录无残留且规则链接有效',async()=>{
 const root=new URL('../src/node_box/',import.meta.url),nodes=[]
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isDirectory())continue;const node=entry.name;
  const parent=await readdir(new URL(node+'/',root));if(!parent.includes('skills'))continue
  const directory=new URL(node+'/skills/',root),entries=await readdir(directory,{withFileTypes:true}),files=entries.map(e=>e.name),formats=files.filter(f=>f.endsWith('-output-format.json'))
  if(!formats.length)continue;nodes.push(node)
  const ruleFiles=files.filter(f=>/-(generate|review|revise)\.md$|-output-format\.json$/.test(f));assert.deepEqual(ruleFiles.sort(),['generate.md','review.md','revise.md','output-format.json'].map(s=>node+'-'+s).sort());assert.ok(files.every(f=>!/\p{Script=Han}/u.test(f)))
  assert.ok(entries.every(e=>e.isFile()));assert.equal(files.length,4);assert.ok(!parent.some(f=>/-(generate|review|revise)\.md$|-output-format\.json$/.test(f)))
  const format=await readNodeFormat(node);for(const action of ['generate','review','revise']){
   assert.ok(format[action]);const source=await readNodeRule(node,action);assert.match(source,/^---\nname: drama-/)
   for(const [,link]of source.matchAll(/\]\(([^)]+)\)/g))if(!link.startsWith('http'))await access(new URL(link,nodeRuleFile(node,action)))
  }
 }
 assert.equal(nodes.length,6);await assert.rejects(access(new URL('../skills/',import.meta.url)),{code:'ENOENT'})
 assert.throws(()=>nodeRuleFile('../script_revision','generate'),/无效/);assert.throws(()=>nodeRuleFile('script_revision','constructor'),/无效/)
})

test('当前四个文本节点动作和返回格式同源，短剧字段引用保留实时描述与严格契约',async()=>{
 for(const stage of textStages){
  assert.match(await actionRules(stage,'generate'),/name: drama-/)
  assert.deepEqual(outputContract(stage,{},'review'),reviewContract)
  if(stage==='shot_design'){
   const revision=outputContract(stage,{},'revise')
   assert.equal(revision.additionalProperties,false)
   assert.equal(revision.properties.shots,undefined)
   assert.deepEqual(revision.properties.shot_updates.items.properties.shot,outputContract(stage,{}).properties.shots.items)
   assert.deepEqual(revision.properties.shot_additions.items,outputContract(stage,{}).properties.shots.items)
   assert.deepEqual(revision.properties.shot_removals.items.required,['shot_number','reason'])
  }else assert.deepEqual(outputContract(stage,{},'revise'),outputContract(stage,{}))
 }
 assert.equal(outputContract('shot_design',{}).properties.assets.properties.characters.items.properties.id,undefined)
 assert.equal(outputContract('shot_design',{}).properties.assets.properties.characters.items.properties.voice_description.type,'string')
 assert.equal(outputContract('adaptation_plan',{}).properties.story_direction.description,projectDocumentSchema.properties.adaptation_plan.properties.data.properties.story_direction.description)
 assert.equal(outputContract('adaptation_plan',{}).properties.story_direction.properties.main_plot.type,'string')
 for(const action of ['generate','revise'])assert.deepEqual(outputContract('adaptation_plan',{},action),projectDocumentSchema.properties.adaptation_plan.properties.data)
})

test('复制src后返回格式文件修改实际影响契约，不依赖docs或旧集中目录',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'drama-flat-rule-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 await cp(new URL('../src/',import.meta.url),join(dir,'src'),{recursive:true});await symlink(resolve(new URL('../../../node_modules',import.meta.url).pathname),join(dir,'node_modules'),'dir')
 const file=join(dir,'src/node_box/adaptation_plan/skills/adaptation_plan-output-format.json'),format=JSON.parse(await readFile(file,'utf8'));format.generate.schema.description='动态规则加载验证';await writeFile(file,JSON.stringify(format))
 const code="import assert from 'node:assert/strict';import {outputContract} from './src/node_box/shared/agent/contracts.js';assert.equal(outputContract('adaptation_plan',{}).description,'动态规则加载验证');assert.notEqual(outputContract('adaptation_plan',{},'revise').description,'动态规则加载验证');assert.equal(outputContract('adaptation_plan',{}).properties.character_plans.type,'array');console.log('ok')"
 assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8'}).trim(),'ok')
})
