import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSshCommand, updateHostBlock } from '../../scripts/switch-ssh.mjs'

test('parseSshCommand accepts the provider SSH command and validates the port', () => {
  assert.deepEqual(parseSshCommand('ssh -p 52274 root@connect.westb.seetacloud.com'), {
    hostname: 'connect.westb.seetacloud.com',
    port: '52274',
    user: 'root',
  })
  assert.throws(() => parseSshCommand('ssh -p 70000 root@example.com'), /1–65535/)
  assert.throws(() => parseSshCommand('ssh root@example.com'), /格式/)
})

test('updateHostBlock changes only connection fields for the selected alias', () => {
  const config = `Host veo-comfyui
    HostName ssh.runpod.io
    User old-user
    IdentityFile ~/.ssh/id_ed25519_veo_comfyui

Host veo-qwen38
    HostName connect.westd.seetacloud.com
    User root
    Port 34728
    IdentityFile ~/.ssh/id_ed25519_veo_qwen38
`
  const updated = updateHostBlock(config, 'veo-qwen38', {
    hostname: 'connect.westb.seetacloud.com',
    port: '52274',
    user: 'root',
  })

  assert.match(updated, /Host veo-comfyui\n    HostName ssh\.runpod\.io\n    User old-user/)
  assert.match(updated, /Host veo-qwen38\n    HostName connect\.westb\.seetacloud\.com\n    User root\n    Port 52274/)
  assert.match(updated, /IdentityFile ~\/\.ssh\/id_ed25519_veo_qwen38/)
  assert.doesNotMatch(updated, /connect\.westd\.seetacloud\.com|Port 34728/)
})

test('updateHostBlock refuses to create an unknown host block', () => {
  assert.throws(
    () => updateHostBlock('Host other\n    HostName example.com\n', 'veo-qwen38', { hostname: 'new.example.com', port: '22', user: 'root' }),
    /Host veo-qwen38/,
  )
})
