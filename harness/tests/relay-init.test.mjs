import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { knownHostEntries, missingKnownHosts, renderBlocks, upsertHostBlock } from '../../init/relay.mjs'

const relay = JSON.parse(readFileSync(new URL('../../init/relay.json', import.meta.url), 'utf8'))
const render = config => renderBlocks(relay).reduce((text, [alias, block]) => upsertHostBlock(text, alias, block), config)

test('renderBlocks keeps identity fields of relay and direct aliases', () => {
  const blocks = Object.fromEntries(renderBlocks(relay))
  assert.match(blocks['veo-comfyui'], /HostName 127\.0\.0\.1\n    Port 22001\n    User root\n    HostKeyAlias veo-comfyui\n    ProxyJump veo-hk\n    IdentityFile ~\/\.ssh\/id_ed25519_veo_comfyui/)
  assert.match(blocks['veo-qwen38-direct'], /HostName connect\.westd\.seetacloud\.com\n    User root\n    Port 23237\n    IdentityFile ~\/\.ssh\/id_ed25519_veo_qwen38/)
  assert.match(blocks['veo-hk'], /HostName 43\.154\.247\.11\n    User ubuntu\n    IdentityFile ~\/\.ssh\/id_ed25519_veo_hk/)
})

test('upsertHostBlock replaces whole blocks, keeps other hosts and is idempotent', () => {
  const config = 'Host other\n    HostName example.com\n\nHost veo-comfyui\n    HostName old.example.com\n    Port 1\n\nHost veo-comfyui-extra\n    HostName keep.example.com\n'
  const once = render(config)
  assert.equal(render(once), once)
  assert.match(once, /Host other\n    HostName example\.com/)
  assert.match(once, /Host veo-comfyui-extra\n    HostName keep\.example\.com/)
  assert.doesNotMatch(once, /old\.example\.com|Port 1\n/)
  assert.equal(once.match(/^Host veo-comfyui$/gm).length, 1)
  assert.equal(render(''), render(render('')))
})

test('missingKnownHosts adds absent keys and refuses conflicting ones', () => {
  const entries = knownHostEntries(relay)
  assert.deepEqual(missingKnownHosts(entries, () => []), entries)
  assert.deepEqual(missingKnownHosts(entries, name => [entries.find(([entry]) => entry === name)[1]]), [])
  assert.throws(() => missingKnownHosts(entries, () => ['ssh-ed25519 AAAAother']), /不一致/)
})
