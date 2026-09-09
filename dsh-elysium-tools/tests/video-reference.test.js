import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareVideoReferences } from '../src/workflows/video-reference.js'
import { validateVideoPlan } from '../src/workflows/video-plan.js'
import { buildVideoGraph, loadVideoTemplates } from '../src/workflows/video-graph.js'
const run = promisify(execFile)
const root = await realpath(await mkdtemp(join(tmpdir(), 'single-reference-')))
process.env.ARTIFACTS_ROOT = root
after(() => rm(root, { recursive: true, force: true }))
const source = join(root, 'sheet.png'), ppm = join(root, 'sheet.ppm')
const row = [255,0,0,255,0,0,0,255,0,0,255,0,0,0,255,0,0,255]
await writeFile(ppm, Buffer.concat([Buffer.from('P6\n6 2\n255\n'), Buffer.from([...row,...row])]))
await run('ffmpeg', ['-v','error','-i',ppm,source])
const shot = { id: 's1', mode: 'reference', duration: 10, prompt: 'One actor opens the hatch.',
  seed: 42, image_role: 'character-sheet', image_path: source, image_crop: { x: 2, y: 0, width: 2, height: 2 } }

test('only selected source pixels reach director inputs; archive and plan stay unchanged', async () => {
  const before = await readFile(source)
  const plan = { duration: 30, shots: [shot, { ...shot, id: 's2' },
    { ...shot, id: 's3', image_crop: { x: 4, y: 0, width: 2, height: 2 } }] }
  await validateVideoPlan(plan)
  const { effective, references } = await prepareVideoReferences(plan, join(root, 'derived'))
  assert.equal(references.length, 2)
  assert.equal(effective.shots[0].image_path, effective.shots[1].image_path)
  assert.notEqual(effective.shots[0].image_path, effective.shots[2].image_path)
  assert.equal(plan.shots[0].image_path, source)
  assert.deepEqual(await readFile(source), before)
  const { stdout } = await run('ffmpeg', ['-v','error','-i',effective.shots[0].image_path,
    '-f','rawvideo','-pix_fmt','rgb24','pipe:1'], { encoding: 'buffer' })
  assert.deepEqual([...stdout], Array.from({ length: 4 }, () => [0,255,0]).flat())
  const media = Object.fromEntries(references.map((r,i) => [r.path,{name:`single-${i}.png`}]))
  const built = buildVideoGraph(effective, media, await loadVideoTemplates(), 'control')
  assert.equal(built.workflowName, 'workflow_director_video')
  for (let i=0; i<3; i++) {
    const director=built.graph[`s${i}_director`].inputs
    assert.equal(JSON.parse(director.timeline_data).items[0].value, `single-${i===2 ? 1 : 0}.png`)
    assert.equal(director.prompt, shot.prompt)
    assert.equal(director.duration, 10)
    assert.equal(built.graph[`s${i}_noise`].inputs.seed_value, 42)
  }
})

test('invalid or out-of-bounds crops fail without clamping or falling back to full sheet', async () => {
  for (const image_crop of [null, {}, {x:-1,y:0,width:2,height:2}, {x:0.5,y:0,width:2,height:2},
    {x:0,y:0,width:0,height:2}, {x:0,y:0,width:2,height:2,extra:1}]) {
    await assert.rejects(validateVideoPlan({duration:10,shots:[{...shot,image_crop}]}), /image_crop/)
  }
  await assert.rejects(validateVideoPlan({duration:10,shots:[{...shot,image_path:undefined}]}), /image_path/)
  await assert.rejects(prepareVideoReferences({shots:[{...shot,image_crop:{x:5,y:0,width:2,height:2}}]},join(root,'outside')), /超出原图边界/)
  const plain={duration:10,shots:[{...shot}]};delete plain.shots[0].image_crop; delete plain.shots[0].image_role
  assert.deepEqual(await prepareVideoReferences(plain,join(root,'unused')), {effective:plain,references:[]})
})

test('declared character archive requires a selected view; ordinary scene inputs remain valid', async () => {
  const bare = { ...shot }; delete bare.image_crop
  await assert.rejects(validateVideoPlan({duration:10,shots:[bare]}), /角色三视图/)
  for (const image_role of ['scene', 'single-view']) await validateVideoPlan({duration:10,shots:[{...bare,image_role}]})
  await assert.rejects(validateVideoPlan({duration:10,shots:[{...shot,image_role:'unknown'}]}), /image_role/)
})
