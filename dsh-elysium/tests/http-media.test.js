import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaReference } from '../src/comfyui/media-reference.js'
import { withConfig } from '../src/config.js'
import { ComfyClient } from '../src/comfyui/client.js'

const config = { COMFYUI_URL: 'https://comfy.test/comfy/' }
test('HTTP media references reuse configured backend files without uploading', () => withConfig(config, () => {
  const reference = mediaReference('https://comfy.test/comfy/view?filename=图.png&subfolder=shots/01&type=output')
  assert.equal(reference.name, 'shots/01/图.png [output]')
  assert.equal(new URL(reference.url).origin, 'https://comfy.test')
  assert.equal(new URL(reference.url).searchParams.get('filename'), '图.png')
  assert.equal(mediaReference('https://comfy.test/comfy/view?filename=pose.png&type=input').name, 'pose.png [input]')
  assert.equal(ComfyClient.prototype.upload, undefined)
  assert.throws(() => mediaReference('https://comfy.test/comfy/view?filename=audio.wav', ['.png']), /类型不匹配/)
}))
test('media references reject local, SSH, foreign and traversing inputs', () => withConfig(config, () => {
  for (const value of ['/tmp/a.png', 'file:///tmp/a.png', 'ssh://host/root/a.png',
    'https://foreign.test/view?filename=a.png', 'https://comfy.test/not-view?filename=a.png',
    'https://comfy.test/comfy/view?filename=../a.png', 'https://comfy.test/comfy/view?filename=a.png&subfolder=../outside',
    'https://comfy.test/comfy/view?filename=a.png&type=temp', 'https://comfy.test/comfy/view?filename=a%00.png',
    'https://user:password@comfy.test/comfy/view?filename=a.png']) assert.throws(() => mediaReference(value))
}))
