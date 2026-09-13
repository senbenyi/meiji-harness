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
const read = path => readFile(path, 'utf8').then(JSON.parse)

test('available third-cup template has verified real media, schemas and all 120 exact shot mappings', async () => {
  const [manifest] = await verifyMedia(root)
  assert.equal(manifest.files.length, 122)
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
    const receipt = await read(join(root, record.provenance)), edit = await read(join(root, record.edit_record))
    assert.equal(receipt.job_id, shot.job_id); assert.equal(edit.job_id, shot.job_id); assert.equal(record.job_id, shot.job_id)
    assert.equal(edit.url, receipt.result.comfyui_view_url)
    const job = await read(join(root, 'jobs', shot.job_id, 'status.json'))
    assert.equal(job.status, 'succeeded'); assert.equal(localMediaValue(job.result).path, record.path)
    assert.equal(job.result.specification.frames, 72); assert.equal(job.result.source_specification.frames, 73)
    hashes.add(record.sha256)
  }
  assert.equal(jobs.size, 120); assert.equal(hashes.size, 120)
  const film = manifest.files.find(file => file.purpose === 'film')
  assert.equal(film.size_bytes, 30976621); assert.equal(film.sha256, 'e7150aa366b54ef9c454b3f72b6e7147d4ee653cfed846c47403d913bac8cd0c')
  const spec = JSON.parse(execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,nb_frames,duration','-of','json',join(root,film.path)], { encoding: 'utf8' })).streams[0]
  assert.deepEqual(spec, { width:384, height:512, r_frame_rate:'24/1', duration:'360.000000', nb_frames:'8640' })
  assert.equal(manifest.files.find(file => file.purpose === 'subtitle').sha256, 'b15ca54885e1a006145935bea3bebb9e787f4d01a0ea00b7fe91e30243ead5de')
  assert.equal(manifest.complete, false); assert.equal(manifest.missing.filter(item => item.purpose === 'anchor').length, 4)
  assert.equal(manifest.missing.filter(item => item.purpose === 'original-shot').length, 120)
  for (const anchor of project.anchors) {
    assert.ok(!jobs.has(anchor.source.job_id)); assert.ok(project.materials.includes(anchor.source.job_id))
    const job = await read(join(root,'jobs',anchor.source.job_id,'status.json'))
    assert.equal(job.error_code, 'TEMPLATE_MEDIA_MISSING')
  }
  assert.equal((await readdir(join(root,'projects'))).includes('1f7712c5'), false)
  assert.ok((await readdir(root)).includes('sessions'))
})

test('first install copies media; reinstall preserves entire existing projects, jobs, directors and productions', async t => {
  const target = await mkdtemp(join(tmpdir(),'third-cup-install-'))
  t.after(() => rm(target,{recursive:true,force:true}))
  await installStorage(root,target)
  await verifyMedia(target)
  for (const path of ['directors.json','projects/0853b1fa/project.json','jobs/user/status.json','productions/user/receipt.json','projects/1f7712c5/project.json']) {
    await mkdir(join(target,path,'..'),{recursive:true}); await writeFile(join(target,path),'user data')
  }
  await rm(join(target,'projects/0853b1fa/materials.json'))
  await installStorage(root,target)
  for (const path of ['directors.json','projects/0853b1fa/project.json','jobs/user/status.json','productions/user/receipt.json','projects/1f7712c5/project.json']) assert.equal(await readFile(join(target,path),'utf8'),'user data')
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
  await writeFile(join(target,manifest.files[0].path),'version https://git-lfs.github.com/spec/v1\noid sha256:missing\nsize 100\n')
  await assert.rejects(verifyMedia(target),/Git LFS.*实体化/)
  for (const value of ['', '/', './relative']) assert.throws(() => dshHome(value), /DSH_HOME/)
  assert.equal(dshHome(target), target)
})

test('offline HTTP traversal validates all 120 videos, film, subtitle and explicit missing anchors', async t => {
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
  const manifest = await read(join(root,'media/third-cup/manifest.json'))
  for (const record of manifest.files) {
    const base = `${origin}${MEDIA_ROUTE}`, query = `?t=offline-test&job=${record.job_id}`
    const status = await (await fetch(`${base}/status${query}`)).json()
    assert.equal(status.status,'succeeded'); assert.equal(status.has_download,true)
    const endpoint = record.purpose === 'subtitle' ? 'download' : 'video'
    assert.equal(status.has_video,endpoint === 'video')
    const response = await fetch(`${base}/${endpoint}${query}`)
    assert.equal(response.status,200)
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),record.sha256)
    const head = await fetch(`${base}/${endpoint}${query}`,{method:'HEAD'})
    assert.equal(head.status,200); assert.equal(Number(head.headers.get('content-length')),record.size_bytes)
    const partial = await fetch(`${base}/${endpoint}${query}`,{headers:{Range:'bytes=0-31'}})
    assert.equal(partial.status,206); assert.equal((await partial.arrayBuffer()).byteLength,32)
  }
  for (const missing of manifest.missing.filter(item => item.purpose === 'anchor')) {
    const status = await (await fetch(`${origin}${MEDIA_ROUTE}/status?t=offline-test&job=${missing.job_id}`)).json()
    assert.equal(status.has_image,false); assert.match(status.media_error,/参考图缺失/)
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
