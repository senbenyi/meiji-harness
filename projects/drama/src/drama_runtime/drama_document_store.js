import {assertSourceText} from '../shared/text/source.js'
import {mkdir,readFile,writeFile,rename,realpath,stat} from 'node:fs/promises'
import {join,resolve,relative,sep} from 'node:path'
import {stageProduct} from '../shared/production/production_stages.js'
import {randomUUID} from 'node:crypto'
import {createProjectDocument,assertProjectDocument,editProjectProduct,projectStages} from './drama_document.js'

// V4文档读写基础层：新建即使用新契约，不读取/迁移旧版数据，不依赖AI节点。
export class ProjectDocumentStore {
 #pending=new Map()
 constructor(root){if(typeof root!=='string'||!root.trim())throw new TypeError('需要短剧存储目录');this.root=resolve(root)}
 directory(id){if(typeof id!=='string'||!/^p_[a-zA-Z0-9_-]+$/.test(id))throw new TypeError('短剧ID无效');return join(this.root,'projects',id)}
 async #serial(id,work){const prior=this.#pending.get(id)||Promise.resolve();const next=prior.catch(()=>{}).then(work);this.#pending.set(id,next);try{return await next}finally{if(this.#pending.get(id)===next)this.#pending.delete(id)}}
 async #save(id,document){assertProjectDocument(document);if(document.source_analysis.source_revision_id){const source=document.source.revisions.find(row=>row.id===document.source_analysis.source_revision_id);assertSourceText((await this.readArtifact(id,source.file_ref)).toString(),document.source_analysis.chapters);}await this.validateImages?.(document);const path=join(this.directory(id),'project.json'),temp=join(this.directory(id),`.project-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(document,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);return structuredClone(document)}
 async read(id){const document=JSON.parse(await readFile(join(this.directory(id),'project.json'),'utf8'));if(document.schema_version!==4)throw Object.assign(new Error('旧数据不再支持，请清空后创建新短剧'),{code:'UNSUPPORTED_PROJECT_VERSION'});if(document.basic_info?.id!==id)throw new TypeError('短剧文件归属错误');return assertProjectDocument(document)}
 async writeArtifact(id,body,{kind='artifacts',extension='txt'}={}){
  if(!['artifacts','sources','media','audio','exports'].includes(kind)||!['txt','json','png','jpg','webp','wav','mp3','mp4','srt'].includes(extension))throw new TypeError('文件类别或扩展名无效')
  if(typeof body!=='string'&&!Buffer.isBuffer(body))throw new TypeError('文件内容无效')
  const directory=join(this.directory(id),kind);await mkdir(directory,{recursive:true,mode:0o700});const ref=`${kind}/${randomUUID()}.${extension}`;await writeFile(join(this.directory(id),ref),body,{flag:'wx',mode:0o600});return ref
 }
 async #artifactPath(id,ref){
  if(typeof ref!=='string'||! /^(artifacts|sources|media|audio|exports)\/[a-zA-Z0-9_.-]+$/.test(ref)||ref.split('/').includes('..'))throw new TypeError('文件引用无效')
  const base=await realpath(this.directory(id)),path=await realpath(join(base,ref));if(relative(base,path).startsWith('..')||!path.startsWith(base+sep))throw new TypeError('文件引用越界')
  if(!(await stat(path)).isFile())throw new TypeError('引用不是文件')
  return path
 }
 async readArtifact(id,ref,{start=0,end}={}){
  const bytes=await readFile(await this.#artifactPath(id,ref))
  if(end===undefined)return bytes
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>16000)throw new TypeError('读取范围无效，单次最多16000字符')
  return bytes.toString('utf8').slice(start,end)
 }
 async create(info){const {original_script='',original_name='剧本.txt',...metadata}=info;const id=metadata.id||`p_${randomUUID()}`
  if(typeof original_script!=='string'||Buffer.byteLength(original_script)>24*1024*1024)throw new TypeError('原稿需为不超过24MiB的文本')
  return this.#serial(id,async()=>{
   try{await readFile(join(this.directory(id),'project.json'));throw Object.assign(new Error('短剧已经存在'),{code:'PROJECT_EXISTS'})}catch(error){if(error.code!=='ENOENT')throw error}
   const document=createProjectDocument({...metadata,id});await mkdir(this.directory(id),{recursive:true,mode:0o700})
   if(original_script.trim()){
    const file_ref=await this.writeArtifact(id,original_script,{kind:'sources'}),sourceId=`src_${randomUUID()}`
    document.source={current_revision_id:sourceId,revisions:[{id:sourceId,file_ref,original_name,character_count:original_script.length,line_index_ref:null}]}
   }
   document.node_states.project.status='confirmed';return this.#save(id,document)
  })
 }
 async replaceSource(id,text,{original_name='剧本.txt',expectedRevision}={}){
  if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>24*1024*1024)throw new TypeError('原稿需为非空且不超过24MiB的文本')
  return this.#serial(id,async()=>{
   const document=await this.read(id);if(expectedRevision!==document.node_states.project.product_revision)throw Object.assign(new Error('原稿已被修改，请刷新'),{code:'EDIT_CONFLICT'})
   const file_ref=await this.writeArtifact(id,text,{kind:'sources'}),sourceId=`src_${randomUUID()}`,source={current_revision_id:sourceId,revisions:[...document.source.revisions,{id:sourceId,file_ref,original_name,character_count:text.length,line_index_ref:null}]}
   const next=editProjectProduct(document,'project',source,{expectedRevision});next.node_states.project.status='confirmed';return this.#save(id,next)
  })
 }
 async saveProduct(id,stage,value,{expectedRevision}={}){
  if(stage==='project')throw new TypeError('原稿请通过新版本导入接口修改')
  return this.#serial(id,async()=>{
   const document=await this.read(id),resolved=await this.resolveInline(id,value),next=editProjectProduct(document,stage,resolved,{expectedRevision})
   if(stage==='video_render')for(const take of next.videos){const before=document.videos.find(row=>row.id===take.id);const withoutStatus=({status,...rest})=>rest;if(!before||JSON.stringify(withoutStatus(before))!==JSON.stringify(withoutStatus(take)))throw new TypeError('人工只能选用/拒绝实际视频，媒体事实不能手改')}
   if(stage==='delivery'&&JSON.stringify(document.delivery.exports)!==JSON.stringify(next.delivery.exports))throw new TypeError('导出记录由真实导出程序维护，人工请编辑集界和输出设置')
   // 文件存在是程序事实，不能靠人工编辑JSON声称已经生成。
   const check=async value=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(key.endsWith('_ref')&&typeof item==='string')await this.#artifactPath(id,item);else if(item&&typeof item==='object')await check(item)}}
   await check(stageProduct(next,stage))
   await this.writeArtifact(id,JSON.stringify(document),{extension:'json'})
   return this.#save(id,next)
  })
 }
 async editText(id,stage,ref,text,{expectedRevision}={}){
  if(typeof text!=='string'||Buffer.byteLength(text)>24*1024*1024)throw new TypeError('正文不能超过24MiB')
  if(stage==='project'||!ref||!['txt','json','srt'].includes(ref.split('.').at(-1)))throw new TypeError('原稿须通过导入保存新版本')
  return this.#serial(id,async()=>{
   const document=await this.read(id),definition=projectStages.find(row=>row.id===stage)
   if(!definition)throw new TypeError('未知制作步骤')
   if(expectedRevision!==document.node_states[stage].product_revision)throw Object.assign(new Error('产物已被修改，请刷新'),{code:'EDIT_CONFLICT'})
   await this.readArtifact(id,ref)
   const value=structuredClone(stageProduct(document,stage));let found=false
   const replace=value=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(key.endsWith('_ref')&&item===ref){value[key]=replacement;found=true}else if(item&&typeof item==='object')replace(item)}}
   const contains=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>key.endsWith('_ref')&&item===ref||item&&typeof item==='object'&&contains(item))
   if(!contains(value))throw new TypeError('正文不属于本阶段产物')
   if(ref.endsWith('.json'))JSON.parse(text)
   if(stage==='delivery')throw new TypeError('实际导出记录不可编辑，请编辑输出设置或集界')
   const replacement=await this.writeArtifact(id,text,{extension:ref.split('.').at(-1)});replace(value)
   if(!found)throw new TypeError('正文不属于本阶段产物')
   const next=editProjectProduct(document,stage,value,{expectedRevision});await this.writeArtifact(id,JSON.stringify(document),{extension:'json'});return this.#save(id,next)
  })
 }
 async saveBasicInfo(id,value,{expectedRevision,source}={}){
  return this.#serial(id,async()=>{
   const document=await this.read(id)
   if(expectedRevision!==document.node_states.project.product_revision)throw Object.assign(new Error('短剧信息已被修改，请刷新'),{code:'EDIT_CONFLICT'})
   if(!value||Object.keys(value).sort().join(',')!=='aspect_ratio,creation_mode,name,output_language')throw new TypeError('短剧信息字段无效')
   document.basic_info={id:document.basic_info.id,...value};assertProjectDocument(document)
   if(source!==undefined){
    if(!source||typeof source.text!=='string'||!source.text.trim()||Buffer.byteLength(source.text)>24*1024*1024||typeof(source.original_name??'剧本.txt')!=='string'||!(source.original_name??'剧本.txt').trim())throw new TypeError('原稿需为非空且不超过24MiB的文本，文件名不能为空')
    const file_ref=await this.writeArtifact(id,source.text,{kind:'sources'}),sourceId=`src_${randomUUID()}`
    document.source={current_revision_id:sourceId,revisions:[...document.source.revisions,{id:sourceId,file_ref,original_name:source.original_name??'剧本.txt',character_count:source.text.length,line_index_ref:null}]};document.node_states.project.status='confirmed'
   }
   document.document_revision++;document.node_states.project.product_revision++
   return this.#save(id,document)
  })
 }
 async mutate(id,change){
  return this.#serial(id,async()=>{const document=await this.read(id);const next=await change(structuredClone(document));next.document_revision=document.document_revision+1;return this.#save(id,next)})
 }
 async resolveInline(id,value){
  if(Array.isArray(value))return Promise.all(value.map(item=>this.resolveInline(id,item)))
  if(!value||typeof value!=='object')return value
  const result={}
  for(const [key,item]of Object.entries(value)){
   if(key.endsWith('_ref')&&item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.$text==='string'){
    const extension=item.$format||'txt';if(!['txt','json','srt'].includes(extension)||Buffer.byteLength(item.$text)>24*1024*1024)throw new TypeError('内联正文格式或长度无效')
    if(extension==='json')JSON.parse(item.$text)
    result[key]=await this.writeArtifact(id,item.$text,{extension})
   }else result[key]=await this.resolveInline(id,item)
  }
  return result
 }
 async saveRules(id,stage,value,{previous}={}){
  if(!value||Object.values(value).some(text=>typeof text!=='string'||text.length>10000))throw new TypeError('每个动作补充规则最多10000字符')
  return this.mutate(id,document=>{const node=document.node_states[stage];if(!node)throw new TypeError('未知步骤');if(JSON.stringify(node.rules)!==JSON.stringify(previous))throw Object.assign(new Error('规则已被修改'),{code:'EDIT_CONFLICT'});node.rules=value;return document})
 }
 async recordExecution(id,stage,execution){
  return this.#serial(id,async()=>{const document=await this.read(id),node=document.node_states[stage];if(!node)return document
   if(JSON.stringify(node.last_execution)===JSON.stringify(execution))return document
   node.last_execution=structuredClone(execution);document.document_revision++;return this.#save(id,document)
  })
 }
 async saveOpinion(id,stage,opinion,{previous}={}){
  if(!projectStages.some(row=>row.id===stage)||typeof opinion!=='string'||opinion.length>10000)throw new TypeError('阶段或意见内容无效')
  return this.#serial(id,async()=>{const document=await this.read(id);if(document.node_states[stage].opinion!==previous)throw Object.assign(new Error('意见已被修改，请刷新'),{code:'EDIT_CONFLICT'});document.node_states[stage].opinion=opinion;document.document_revision++;return this.#save(id,document)})
 }
 async dispose(){await Promise.allSettled([...this.#pending.values()])}
}
