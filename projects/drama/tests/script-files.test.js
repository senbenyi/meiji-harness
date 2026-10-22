import { originalFilename } from '../src/node_runtime/node_state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ProjectService } from '../src/node_box/project/service.js'
import { createLibraryStore } from '../src/library/library_store.js'
import { saveProjectScript, readProjectScript } from '../src/node_box/project/script_files.js'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'drama-script-source-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const projects=new ProjectService({root,workspaceController:{create:async()=>({workspace:{workspaceId:randomUUID()}}),rename:async()=>{}},sessionController:{create:async({sessionId})=>({sessionId})}})
  return {root,projects,library:createLibraryStore(root)}
}

test('创建自动入库并保存原名沙盒文件，JSON只存路径，工作稿立即包含正文，重试不重复入库',async t=>{
  const {root,projects,library}=await fixture(t),info={name:'本地来源',original_script:'原始正文\n第二场',original_script_filename:'雨停之前.md'},context={sessionId:'source',requestId:'create'}
  const created=await projects.create(info,context),{project}=await projects.snapshot(created.session_id)
  assert.match(project.basic_info.original_script_file_path,/^sources\/[a-f0-9]{64}\/雨停之前\.md$/)
  assert.equal(originalFilename(project.basic_info),'雨停之前.md')
  assert.equal(project.basic_info.actual_script,info.original_script)
  assert.equal((await projects.readOriginalScript(created.session_id)).body,info.original_script)
  assert.equal(await readFile(join(root,'projects',created.project_id,project.basic_info.original_script_file_path),'utf8'),info.original_script)
  assert.equal((await library.list()).length,1)
  assert.equal((await projects.create(info,context)).project_id,created.project_id)
  await projects.create({...info,name:'第二个项目'},{sessionId:'source',requestId:'second'})
  assert.equal((await library.list()).length,1)
  const raw=JSON.parse(await readFile(join(root,'projects',created.project_id,'project.json'),'utf8'))
  assert.equal(raw.basic_info.original_script_file_path,project.basic_info.original_script_file_path)
})

test('素材库选稿复用素材，替换原稿更新工作副本并保留旧来源文件',async t=>{
  const {root,projects,library}=await fixture(t)
  await library.importScript({originalName:'素材剧本.txt',body:'素材正文'})
  const created=await projects.create({name:'复用素材',original_script:'素材正文',original_script_filename:'素材剧本.txt'},{sessionId:'source',requestId:'one'})
  const first=(await projects.snapshot(created.session_id)).project
  const result=await projects.edit({kind:'import_script',value:'替换正文',originalName:'新版本.md',previousValue:first.basic_info.original_script_file_path},{sessionId:created.session_id,projectId:created.project_id})
  assert.equal(result.project.basic_info.actual_script,'替换正文')
  assert.equal(originalFilename(result.project.basic_info),'新版本.md')
  assert.equal(result.project.basic_info.script_revision_node.status,'empty')
  assert.equal(await readProjectScript(root,created.project_id,first.basic_info.original_script_file_path),'素材正文')
  assert.equal((await library.list()).length,2)
})

test('来源文件拒绝目录穿越及符号链接越界',async t=>{
  const {root}=await fixture(t),id=`p_${randomUUID()}`
  await assert.rejects(saveProjectScript(root,id,{body:'正文',originalName:'../越界.txt'}),/剧本文件/)
  const source=await saveProjectScript(root,id,{body:'正文',originalName:'安全.txt'})
  await assert.rejects(readProjectScript(root,id,'../../secret.txt'),/路径无效/)
  const outside=join(root,'outside.txt');await writeFile(outside,'不可读取')
  const file=join(root,'projects',id,source.original_script_file_path);await rm(file);await symlink(outside,file)
  await assert.rejects(readProjectScript(root,id,source.original_script_file_path),/超出项目沙盒/)
})
