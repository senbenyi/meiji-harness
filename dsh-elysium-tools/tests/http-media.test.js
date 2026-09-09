import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaReference } from '../src/media/http-media.js'
import { withConfig } from '../src/config.js'
import { ComfyClient } from '../src/functions/comfyui/client.js'

const config = { MINIMAX_H3_COMFYUI_URL: 'http://backend.test/comfy/', MINIMAX_H3_COMFYUI_PUBLIC_URL: 'https://public.test/comfy/' }
test('HTTP media references reuse configured backend files without uploading', () => withConfig(config, () => {
  const reference = mediaReference('https://public.test/comfy/view?filename=图.png&subfolder=shots/01&type=output')
  assert.equal(reference.name, 'shots/01/图.png [output]')
  assert.equal(new URL(reference.url).origin, 'http://backend.test')
  assert.equal(new URL(reference.url).searchParams.get('filename'), '图.png')
  assert.equal(mediaReference('http://backend.test/comfy/view?filename=pose.png&type=input').name, 'pose.png [input]')
  assert.equal(ComfyClient.prototype.upload, undefined)
  assert.throws(() => mediaReference('https://public.test/comfy/view?filename=audio.wav', ['.png']), /类型不匹配/)
}))
test('media references reject local, SSH, foreign and traversing inputs', () => withConfig(config, () => {
  for (const value of ['/tmp/a.png', 'file:///tmp/a.png', 'ssh://host/root/a.png',
    'https://foreign.test/view?filename=a.png', 'https://public.test/not-view?filename=a.png',
    'https://public.test/comfy/view?filename=../a.png', 'https://public.test/comfy/view?filename=a.png&subfolder=../outside',
    'https://public.test/comfy/view?filename=a.png&type=temp', 'https://public.test/comfy/view?filename=a%00.png',
    'https://user:password@public.test/comfy/view?filename=a.png']) assert.throws(() => mediaReference(value))
}))
