import {projectDocumentSchema,assertProjectDocument} from '../../../project_runtime/project_document.js'
import {validateDocumentSchema} from '../../../project_runtime/document_validation.js'
import {readFileSync} from 'node:fs'
import {nodeRuleFile} from '../../../shared/nodes/node_rule_files.js'
import {textStages} from './rules.js'
export const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
export const string={type:'string'}, text={type:'string',minLength:1}, list=items=>({type:'array',items})
export const reviewContract=object({status:{type:'string',enum:['passed','content_issue','upstream_issue','rule_conflict']},issues:list(object({location:text,evidence:text,reason:text,suggestion:text})),suggestions:list(string)})
export function outputContract(stage,unit,action='generate'){
 if(!textStages.includes(stage)||!['generate','review','revise'].includes(action))throw new TypeError('此阶段没有文本模型契约')
 const format=JSON.parse(readFileSync(nodeRuleFile(stage,'output'),'utf8'))
 const expand=value=>{
  if(Array.isArray(value))return value.map(expand)
  if(!value||typeof value!=='object')return value
  if(value.$ref){
   const {$ref,...overrides}=value;let base
   if($ref==='shared:review')base=reviewContract
   else if($ref.startsWith('project:/')){base=projectDocumentSchema;for(const key of $ref.slice(9).split('/')){if(!base||!Object.hasOwn(base,key))throw new TypeError('返回格式引用不存在：'+$ref);base=base[key]}}
   else throw new TypeError('返回格式引用无效：'+$ref)
   return expand({...base,...overrides})
  }
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,expand(item)]))
 }
 if(format[action]?.type!=='json'||!format[action].schema)throw new TypeError('文本返回格式缺少JSON Schema')
 return expand(format[action].schema)
}
export function validateReview(value){validateDocumentSchema(reviewContract,value);if(value.status==='passed'&&value.issues.length||value.status!=='passed'&&!value.issues.length)throw new TypeError('审核结论与问题列表不一致');return value}
export function parseCandidate(stage,unit,value){validateDocumentSchema(outputContract(stage,unit),value);return value}
