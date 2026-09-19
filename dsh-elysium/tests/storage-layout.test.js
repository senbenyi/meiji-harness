// 职责：验证所有默认持久化路径遵循 Elysium 五类目录契约。
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { driverFile, jobsRoot, poolsRoot, projectsRoot, runtimeRoot, tasksRoot, uploadsRoot } from '../src/database/paths.js'
import { registryPath } from '../src/database/managers/registry.js'
import { selectionPath } from '../src/database/managers/selection.js'

test('storage paths stay within config, pools, projects, runtime and uploads', () => {
  const root = '/tmp/elysium-layout'
  withConfig({ ELYSIUM_HOME: root, ELYSIUM_STATE_ROOT: root, ELYSIUM_SETTINGS_FILE: join(root, 'config', 'settings.json') }, () => {
    assert.equal(registryPath(), join(root, 'config', 'settings.json'))
    assert.equal(selectionPath(), join(root, 'config', 'settings.json'))
    assert.equal(poolsRoot(), join(root, 'pools'))
    assert.equal(projectsRoot(), join(root, 'projects'))
    assert.equal(tasksRoot(), join(root, 'projects', 'tasks'))
    assert.equal(jobsRoot(), join(root, 'projects', 'jobs'))
    assert.equal(runtimeRoot(), join(root, 'runtime'))
    assert.equal(driverFile(), join(root, 'runtime', 'driver.json'))
    assert.equal(uploadsRoot(), join(root, 'uploads'))
  })
})
