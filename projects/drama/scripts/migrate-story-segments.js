import {readFile,writeFile,mkdir,readdir,copyFile,rename,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {assertProjectDocument} from '../src/drama_runtime/drama_document.js'

// 显式一次性迁移现行文档；历史任务和不可变正文保持原样。
export async function migrateStorySegments(root,{apply=false}={}){
  root=resolve(root)
  try{
    await access(join(root,'records.sqlite'))
    const db=new DatabaseSync(join(root,'records.sqlite'),{readOnly:true})
    try{if(db.prepare("SELECT count(*) AS count FROM agent_tasks WHERE json_extract(data,'$.task_status') IN ('queued','running')").get().count)throw new Error('存在活动任务，请等待完成后迁移')}finally{db.close()}
  }catch(error){if(error.code!=='ENOENT')throw error}
  const changes=[]
  for(const entry of await readdir(join(root,'projects'),{withFileTypes:true})){
    if(!entry.isDirectory())continue
    const path=join(root,'projects',entry.name,'project.json'),document=JSON.parse(await readFile(path,'utf8'))
    const linked=document.story_segments.segments.some(row=>'source_chapter_ids' in row||'source_spans' in row)
    if(!linked)continue
    for(const row of document.story_segments.segments){delete row.source_chapter_ids;delete row.source_spans}
    document.node_states.story_segments.checkpoint=null
    document.document_revision++
    assertProjectDocument(document)
    changes.push({id:entry.name,path,document})
  }
  const backup=changes.length&&apply?join(root,'backups',`independent-story-${Date.now()}`):null
  if(backup){
    await mkdir(backup,{recursive:true})
    for(const change of changes)await copyFile(change.path,join(backup,`${change.id}.json`))
    for(const change of changes){const temporary=change.path+'.story-migration.tmp';await writeFile(temporary,JSON.stringify(change.document,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temporary,change.path)}
  }
  return {apply,changed:changes.length,backup}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv[2]
  if(!root)throw new Error('用法：node migrate-story-segments.js <drama存储目录> [--apply]')
  console.log(JSON.stringify(await migrateStorySegments(root,{apply:process.argv.includes('--apply')})))
}
