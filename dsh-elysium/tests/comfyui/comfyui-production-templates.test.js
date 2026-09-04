import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function json(name) {
  return JSON.parse(await readFile(new URL(`../../templates/comfyui/${name}`, import.meta.url), 'utf8'))
}

test('Qwen production template exposes text-to-image contract', async () => {
  const contract = await json('qwen-image-t2i.contract.json')
  const workflow = await json('qwen-image-t2i.json')
  assert.equal(contract.capabilities.mode[0], 't2i')
  assert.equal(contract.slots.prompt.node, '5')
  assert.equal(workflow['10'].class_type, 'SaveImage')
})

test('Qwen Image Edit contract accepts one reference image for continuation frames', async () => {
  const contract = await json('qwen-image-edit.contract.json')
  const workflow = await json('qwen-image-edit.json')
  assert.equal(contract.capabilities.mode.includes('i2i'), true)
  assert.equal(contract.slots.image.node, '1')
  assert.equal(contract.slots.character_image.node, '14')
  assert.equal(contract.slots.prompt.node, '10')
  assert.equal(workflow['5'].class_type, 'NunchakuQwenImageDiTLoader')
  assert.equal(workflow['13'].class_type, 'SaveImage')
})

test('Wan production template wires six ordered story anchors', async () => {
  const contract = await json('wan22-remix-long.contract.json')
  const workflow = await json('wan22-remix-long.json')
  const order = ['864', '865', '871', '873', '868', '869']
  const images = ['10', '9002', '9003', '9004', '9005', '9006']
  assert.equal(contract.capabilities.mode.includes('six_anchor'), true)
  assert.deepEqual(Object.keys(contract.slots).filter(key => /^image_\d$/.test(key)), ['image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6'])
  order.forEach((nodeId, index) => {
    assert.deepEqual(workflow[nodeId].inputs.start_image, [images[index], 0])
    assert.equal(workflow[nodeId].inputs.enable_start_frame, true)
    if (index < 5) {
      assert.deepEqual(workflow[nodeId].inputs.end_image, [images[index + 1], 0])
      assert.equal(workflow[nodeId].inputs.enable_end_frame, true)
    } else {
      assert.equal(workflow[nodeId].inputs.enable_end_frame, false)
    }
  })
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
