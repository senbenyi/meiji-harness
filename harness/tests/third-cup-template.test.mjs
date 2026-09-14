// 职责：验证实际模板的来源映射、实体媒体及非覆盖安装行为。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { dshHome, installStorage, verifyMedia } from '../scripts/storage-template.mjs'
import { anchorsValue, actsValue, deliverablesValue, materialsValue, titleValue, directorValue, profileValue } from '../../dsh-elysium/src/projects/schema.js'
import { projectSummary } from '../../dsh-elysium/src/projects/store.js'
import { localMediaValue } from '../../dsh-elysium/src/assets/local-media.js'
const root = new URL('../.dsh/storages/elysium/', import.meta.url).pathname
const thirdCup = join(root, 'projects/0853b1fa')
const read = path => readFile(path, 'utf8').then(JSON.parse)

test('offline-complete third-cup template has verified real media, schemas and all 120 exact shot mappings', async () => {
  const [manifest] = await verifyMedia(root)
  assert.equal(manifest.files.length, 126)
  const project = await read(join(root, 'projects/0853b1fa/project.json'))
  for (const [key, name, validate] of [['anchors', 'anchors', anchorsValue], ['acts', 'storyboard', actsValue], ['materials', 'materials', materialsValue], ['deliverables', 'deliverables', deliverablesValue]]) {
    project[key] = await read(join(root, `projects/0853b1fa/${name}.json`))
    assert.deepEqual(validate(project[key]), project[key])
  }
  assert.equal(titleValue(project.title), '第三杯咖啡'); directorValue(project.director); profileValue(project.profile)
  assert.equal(projectSummary(project).status, 'completed')
  assert.equal(project.acts.length, 6); assert.ok(project.acts.every(act => act.shots.length === 20))
  assert.equal(project.materials.length, 126)
  const jobs = new Set(), hashes = new Set()
  for (const shot of project.acts.flatMap(act => act.shots)) {
    assert.equal(shot.status, 'succeeded'); jobs.add(shot.job_id)
    const record = manifest.files.find(file => file.shot === shot.index)
    const receipt = await read(join(thirdCup, record.provenance)), edit = await read(join(thirdCup, record.edit_record))
    assert.equal(receipt.job_id, shot.job_id); assert.equal(edit.job_id, shot.job_id); assert.equal(record.job_id, shot.job_id)
    assert.equal(edit.url, receipt.result.comfyui_view_url)
    const job = await read(join(thirdCup, 'jobs', shot.job_id, 'status.json'))
    assert.equal(job.project_id, '0853b1fa')
    assert.equal(job.status, 'succeeded'); assert.equal(localMediaValue(job.result).path, record.path)
    assert.equal(job.result.specification.frames, 72); assert.equal(job.result.source_specification.frames, 73)
    hashes.add(record.sha256)
  }
  assert.equal(jobs.size, 120); assert.equal(hashes.size, 120)
  const film = manifest.files.find(file => file.purpose === 'film')
  assert.equal(film.size_bytes, 30976621); assert.equal(film.sha256, 'e7150aa366b54ef9c454b3f72b6e7147d4ee653cfed846c47403d913bac8cd0c')
  const spec = JSON.parse(execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,nb_frames,duration','-of','json',join(thirdCup,film.path)], { encoding: 'utf8' })).streams[0]
  assert.deepEqual(spec, { width:384, height:512, r_frame_rate:'24/1', duration:'360.000000', nb_frames:'8640' })
  assert.equal(manifest.files.find(file => file.purpose === 'subtitle').sha256, 'b15ca54885e1a006145935bea3bebb9e787f4d01a0ea00b7fe91e30243ead5de')
  assert.equal(manifest.offline_complete, true); assert.equal(manifest.complete, false)
  assert.equal(manifest.missing.filter(item => item.purpose === 'anchor').length, 0)
  assert.equal(manifest.missing.filter(item => item.purpose === 'original-shot').length, 120)
  for (const anchor of project.anchors) {
    assert.ok(!jobs.has(anchor.source.job_id)); assert.ok(project.materials.includes(anchor.source.job_id))
    const job = await read(join(thirdCup,'jobs',anchor.source.job_id,'status.json'))
    assert.equal(job.status, 'succeeded'); assert.equal(job.result.media_kind, 'image')
    const record = manifest.files.find(file => file.job_id === job.job_id)
    assert.equal(record.purpose, 'anchor'); assert.deepEqual(record.specification, { width:384, height:512, format:'png' })
    const png = await readFile(join(thirdCup,record.path))
    assert.equal(png.subarray(1,4).toString(),'PNG')
    let prompt
    for (let offset=8; offset<png.length;) {
      const size=png.readUInt32BE(offset), type=png.subarray(offset+4,offset+8).toString(), data=png.subarray(offset+8,offset+8+size)
      if (type === 'tEXt' && data.subarray(0,7).toString() === 'prompt\0') prompt=JSON.parse(data.subarray(7).toString())
      offset+=size+12
    }
    assert.equal(prompt['1'].inputs.file,`elysium/${job.result.source_job_id}/preview/final_00001-audio.mp4 [output]`)
    assert.equal(prompt['3'].inputs.batch_index,36)
    assert.equal(prompt['4'].inputs.filename_prefix,`third-cup-preview/references/${anchor.role}`)
  }
  assert.equal((await readdir(join(root,'projects'))).includes('1f7712c5'), false)
  assert.ok((await readdir(root)).includes('runtime'))
})

test('first install copies complete project units; reinstall preserves existing projects, directors and runtime', async t => {
  const target = await mkdtemp(join(tmpdir(),'third-cup-install-'))
  t.after(() => rm(target,{recursive:true,force:true}))
  await installStorage(root,target)
  await verifyMedia(target)
  for (const path of ['directors.json','projects/0853b1fa/project.json','runtime/sessions/user.json','projects/1f7712c5/project.json']) {
    await mkdir(join(target,path,'..'),{recursive:true}); await writeFile(join(target,path),'user data')
  }
  await rm(join(target,'projects/0853b1fa/materials.json'))
  await installStorage(root,target)
  for (const path of ['directors.json','projects/0853b1fa/project.json','runtime/sessions/user.json','projects/1f7712c5/project.json']) assert.equal(await readFile(join(target,path),'utf8'),'user data')
  await assert.rejects(readFile(join(target,'projects/0853b1fa/materials.json')), {code:'ENOENT'})
  await rm(join(target,'projects/0853b1fa'),{recursive:true})
  await installStorage(root,target)
  assert.equal((await read(join(target,'projects/0853b1fa/project.json'))).title,'第三杯咖啡')
})

test('install validation rejects LFS pointers and unsafe DSH_HOME', async t => {
  const target = await mkdtemp(join(tmpdir(),'third-cup-pointer-'))
  t.after(() => rm(target,{recursive:true,force:true}))
  await cp(root,target,{recursive:true})
  const [manifest] = await verifyMedia(target)
  await writeFile(join(target,'projects',manifest.project_id,manifest.files[0].path),'version https://git-lfs.github.com/spec/v1\noid sha256:missing\nsize 100\n')
  await assert.rejects(verifyMedia(target),/Git LFS.*实体化/)
  for (const value of ['', '/', './relative']) assert.throws(() => dshHome(value), /DSH_HOME/)
  assert.equal(dshHome(target), target)
})

test('offline HTTP traversal validates all 120 videos, film, subtitle and all four original anchors', async t => {
  const { createServer } = await import('node:http')
  const { createHash } = await import('node:crypto')
  const { createMediaHandler, MEDIA_ROUTE } = await import('../../dsh-elysium/src/http/media-routes.js')
  const { createProjectHandler, PROJECT_ROUTE } = await import('../../dsh-elysium/src/http/project-routes.js')
  const { withConfig } = await import('../../dsh-elysium/src/config.js')
  const media = createMediaHandler({ token: 'offline-test' }), project = createProjectHandler({ token: 'offline-test' })
  const server = createServer((req,res) => withConfig({ ELYSIUM_STATE_ROOT:root }, () => (req.url.startsWith(PROJECT_ROUTE) ? project : media)(req,res)))
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, originalFetch = globalThis.fetch
  globalThis.fetch = (url,options) => { assert.equal(new URL(url).origin,origin,'外网访问被测试禁止'); return originalFetch(url,options) }
  t.after(async () => { globalThis.fetch = originalFetch; await new Promise(resolve => server.close(resolve)) })
  const projects = await (await fetch(`${origin}${PROJECT_ROUTE}/list?t=offline-test`)).json()
  const summary = projects.find(p => p.id === '0853b1fa')
  assert.equal(summary.status,'completed'); assert.equal(summary.completed_count,120)
  const manifest = await read(join(thirdCup,'media/manifest.json'))
  for (const record of manifest.files) {
    const base = `${origin}${MEDIA_ROUTE}`, query = `?t=offline-test&job=${record.job_id}`
    const status = await (await fetch(`${base}/status${query}`)).json()
    assert.equal(status.status,'succeeded'); assert.equal(status.has_download,true)
    const endpoint = record.purpose === 'subtitle' ? 'download' : record.purpose === 'anchor' ? 'image' : 'video'
    assert.equal(status.has_video,endpoint === 'video'); assert.equal(status.has_image,endpoint === 'image')
    const response = await fetch(`${base}/${endpoint}${query}`)
    assert.equal(response.status,200)
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),record.sha256)
    const head = await fetch(`${base}/${endpoint}${query}`,{method:'HEAD'})
    assert.equal(head.status,200); assert.equal(Number(head.headers.get('content-length')),record.size_bytes)
    const partial = await fetch(`${base}/${endpoint}${query}`,{headers:{Range:'bytes=0-31'}})
    assert.equal(partial.status,206); assert.equal((await partial.arrayBuffer()).byteLength,32)
  }

})


test('template JSON contains no absolute machine paths or credentials', async () => {
  async function walk(directory) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name)
      if(entry.isDirectory()) await walk(path)
      else if(entry.name.endsWith('.json')) {
        const data=JSON.parse(await readFile(path,'utf8'))
        function check(value) {
          if (typeof value === 'string') assert.doesNotMatch(value,/^(?:\/Users\/|\/workspace\/|\/tmp\/|file:\/\/)/)
          else if (value && typeof value === 'object') for (const [key,item] of Object.entries(value)) {
            assert.doesNotMatch(key,/^(?:api_key|access_token|authorization|password)$/i)
            check(item)
          }
        }
        check(data)
      }
    }
  }
  await walk(root)
})

// 发布前须拒绝页面必需素材缺失，即使清单中的其余文件都能通过哈希校验。
test('installer rejects incomplete or unregistered case media', async t => {
  const target = await mkdtemp(join(tmpdir(),'third-cup-incomplete-'))
  t.after(() => rm(target,{recursive:true,force:true}))
  await cp(root,target,{recursive:true})
  const path=join(target,'projects/0853b1fa/media/manifest.json'), manifest=await read(path)
  await writeFile(path,JSON.stringify({...manifest,offline_complete:false}))
  await assert.rejects(verifyMedia(target),/离线浏览素材不完整/)
  await writeFile(path,JSON.stringify({...manifest,files:manifest.files.filter(file=>file.purpose!=='anchor')}))
  await assert.rejects(verifyMedia(target),/未完整登记/)
  await rm(path)
  await assert.rejects(verifyMedia(target),/媒体清单缺失/)
})
