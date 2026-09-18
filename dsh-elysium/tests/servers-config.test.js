// 职责：验证连接清单与动态选择相互隔离，并各自保持并发版本边界。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRegistry } from '../src/servers/registry/schema.js'
import { readRegistry, writeRegistry } from '../src/servers/registry/store.js'
import { readSelection, writeSelection } from '../src/servers/selection/store.js'
import { resolveServer } from '../src/servers/registry/resolve.js'
import { withConfig, resolveConfig } from '../src/utils/config.js'

const fixture = () => ({ version: 1, revision: 0, servers: ['a', 'b'].map(id => ({ id, label: id, provider: 'manual', instance_id: id, deployment_id: 'one', connection_source: 'manual', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })) })

test('registry validates identity, URL, SSH ports and service type; legacy selection fields remain readable', () => {
  assert.equal(validateRegistry(fixture()).servers.length, 2)
  for (const mutate of [v => v.servers[1].id = 'a',
    v => v.servers[0].services.comfyui.base_url = 'http://user:secret@a.test',
    v => v.servers[0].services.comfyui.transport = 'magic',
    v => v.servers[0].services.comfyui = { transport: 'ssh', ssh_alias: 'a', remote_host: 'localhost', local_port: 0, remote_port: 8188, workload: 'minimax-h3' },
    v => v.servers[0].token = 'secret']) {
    const value = fixture(); mutate(value); assert.throws(() => validateRegistry(value))
  }
  assert.equal(validateRegistry({ ...fixture(), active: { comfyui: 'a' }, third_party: { video: 'byteplus:seedance2' } }).third_party.video, 'byteplus:seedance2')
})

test('connection registry and model selection use independent CAS files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servers-'))
  try {
    const runtime = { ELYSIUM_SERVERS_FILE: join(directory, 'servers.json'), ELYSIUM_CONFIG_FILE: join(directory, 'config.json'), COMFYUI_URL: 'http://legacy.test' }
    await withConfig(runtime, async () => {
      assert.equal(resolveServer().base_url, 'http://legacy.test')
      const first = await writeRegistry(fixture(), 0)
      await writeSelection({ version: 1, revision: 0, selected: { video: 'a' }, third_party: {} }, 0)
      assert.equal(resolveServer().server_id, 'a')
      const config = resolveConfig({ home: directory, serversFile: runtime.ELYSIUM_SERVERS_FILE, selectionFile: runtime.ELYSIUM_CONFIG_FILE, comfyUrl: 'invalid legacy URL' })
      assert.equal(config.COMFYUI_URL, undefined)
      assert.equal(withConfig(config, () => resolveServer().server_id), 'a')
      const changed = { ...first, servers: first.servers.map(server => server.id === 'b' ? { ...server, disabled: true } : server) }
      const results = await Promise.allSettled([writeRegistry(changed, 1), writeRegistry(first, 1)])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(readRegistry().revision, 2)
      assert.equal(readSelection().revision, 1)
      await assert.rejects(writeRegistry(first, 1), /版本冲突/)
      const identityChanged = readRegistry(); identityChanged.servers[0].services.comfyui.base_url = 'http://new.test'
      await assert.rejects(writeRegistry(identityChanged, 2), /身份/)
      await writeSelection({ ...readSelection(), selected: { video: null } }, 1)
      assert.throws(() => resolveServer(), /未配置/)
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
