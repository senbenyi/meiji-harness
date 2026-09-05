import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function json(name) {
  return JSON.parse(await readFile(new URL(`../../templates/comfyui/${name}`, import.meta.url), 'utf8'))
}

test('RealVisXL production template exposes text-to-image contract', async () => {
  const contract = await json('realvisxl-t2i.contract.json')
  const workflow = await json('realvisxl-t2i.json')
  assert.equal(contract.capabilities.mode[0], 't2i')
  assert.equal(contract.slots.prompt.node, '2')
  assert.equal(workflow['7'].class_type, 'SaveImage')
})

test('RealVisXL IP-Adapter contract accepts one identity reference image', async () => {
  const contract = await json('realvisxl-ipadapter.contract.json')
  const workflow = await json('realvisxl-ipadapter.json')
  assert.equal(contract.capabilities.mode.includes('i2i'), true)
  assert.equal(contract.slots.reference.node, '8')
  assert.equal(contract.slots.prompt.node, '2')
  assert.equal(workflow['10'].class_type, 'IPAdapter')
  assert.equal(workflow['7'].class_type, 'SaveImage')
})

test('Wan production template wires one identity anchor and six SVI prompts', async () => {
  const contract = await json('wan22-remix-long.contract.json')
  const workflow = await json('wan22-remix-long.json')
  assert.equal(contract.capabilities.mode.includes('svi_continuity'), true)
  assert.equal(contract.slots.image.node, '10')
  assert.equal(Object.keys(contract.slots).filter(key => /^prompt_\d$/.test(key)).length, 6)
  assert.equal(workflow['20'].inputs.unet_name.includes('v3.0'), true)
  assert.equal(workflow['409'].inputs.lora_name.includes('SVI_v2_PRO'), true)
})

test('MMAudio production template accepts a video and emits a video with audio', async () => {
  const contract = await json('mmaudio.contract.json')
  const workflow = await json('mmaudio.json')
  assert.equal(contract.capabilities.mode.includes('video_audio'), true)
  assert.equal(contract.slots.video.node, '1')
  assert.equal(contract.slots.prompt.node, '4')
  assert.deepEqual(contract.media.out, ['video', 'audio'])
  assert.equal(workflow['4'].class_type, 'MMAudioSampler')
  assert.deepEqual(workflow['5'].inputs.audio, ['4', 0])
})
