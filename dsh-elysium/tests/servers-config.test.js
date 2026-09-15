// 职责：验证服务器清单隔离、身份约束与并发版本边界。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRegistry } from '../src/servers/schema.js'
import { readRegistry, writeRegistry } from '../src/servers/store.js'
import { resolveServer } from '../src/servers/resolve.js'
import { withConfig, resolveConfig } from '../src/config.js'
const fixture = () => ({ version: 1, revision: 0, active: { comfyui: 'a' }, servers: ['a', 'b'].map(id => ({ id, label: id, provider: 'manual', instance_id: id, deployment_id: 'one', connection_source: 'manual', services: { comfyui: { transport: 'http', base_url: `http://${id}.test`, workload: 'minimax-h3' } } })) })
test('registry validates identity, URL, SSH ports, service type and selected target', () => {
  assert.equal(validateRegistry(fixture()).servers.length, 2)
  for (const mutate of [v => v.active.comfyui = 'unknown', v => v.servers[1].id = 'a',
    v => v.servers[0].services.comfyui.base_url = 'http://user:secret@a.test',
    v => v.servers[0].services.comfyui.transport = 'magic',
    v => v.servers[0].services.comfyui = { transport: 'ssh', ssh_alias: 'a', remote_host: 'localhost', local_port: 0, remote_port: 8188, workload: 'minimax-h3' },
    v => v.servers[0].token = 'secret']) {
    const value = fixture(); mutate(value); assert.throws(() => validateRegistry(value))
  }
})
test('registry is authoritative, CAS writes do not lose updates, identities remain immutable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'servers-'))
  try {
    await withConfig({ ELYSIUM_SERVERS_FILE: join(directory, 'servers.json'), COMFYUI_URL: 'http://legacy.test' }, async () => {
      assert.equal(resolveServer().base_url, 'http://legacy.test')
      const first = await writeRegistry(fixture(), 0)
      assert.equal(resolveServer().server_id, 'a')
      const config = resolveConfig({ serversFile: join(directory, 'servers.json'), comfyUrl: 'invalid legacy URL' })
      assert.equal(config.COMFYUI_URL, undefined)
      assert.equal(withConfig(config, () => resolveServer().server_id), 'a')
      const results = await Promise.allSettled([writeRegistry({ ...first, active: { comfyui: 'b' } }, 1), writeRegistry(first, 1)])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal(readRegistry().revision, 2)
      await assert.rejects(writeRegistry(first, 1), /版本冲突/)
      const changed = readRegistry(); changed.servers[0].services.comfyui.base_url = 'http://new.test'
      await assert.rejects(writeRegistry(changed, 2), /身份/)
      const noDefault = readRegistry(); noDefault.active.comfyui = null
      await writeRegistry(noDefault, 2)
      assert.throws(() => resolveServer(), /未配置/)
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
