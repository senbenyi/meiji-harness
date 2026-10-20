import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'agent-modules-install-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const archives = [];
  for (const name of ['http-client', 'prompt-composer', 'setting', 'task']) {
    const result = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], join(root, 'packages', name)));
    assert.ok(result[0].files.every(file => !file.path.includes('elysium/')), '公共包不应包含旧网关兼容文件');
    archives.push(join(temp, result[0].filename));
  }
  // task 自身不依赖另外两个公共包，也应能单独安装与运行。
  const taskOnly = join(temp, 'task-only');
  await mkdir(taskOnly);
  await writeFile(join(taskOnly, 'package.json'), JSON.stringify({ name: 'task-only-check', private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archives.at(-1)], taskOnly);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { TaskManager, TaskModel, NodeStateModel } from '@agent-modules/task';
    import { SQLiteTaskStore } from '@agent-modules/task/sqlite';
    import { createTaskHistory } from '@agent-modules/task/ui';
    assert.equal(typeof createTaskHistory, 'function');
    const store = new SQLiteTaskStore();
    const manager = new TaskManager({ store, nodes: { custom: {
      plan: () => [{ kind: 'execute' }], execute: async () => ({ result: 'standalone' }),
    } } });
    const group = manager.submit('scope', { tasks: [{ node_type: 'custom' }] });
    await manager.idle('scope');
    assert.equal(manager.detail('scope', group.group.id).steps[0].result, 'standalone');
    await manager.dispose(); store.close();
  `], taskOnly);
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'independent-agent-check', private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...archives], temp);
  // 确认加载安装后的包，而非开发工作区的符号链接。
  const installed = await realpath(join(temp, 'node_modules/@agent-modules/http-client'));
  assert.ok(installed.startsWith(await realpath(temp)));
  await copyFile(join(root, 'examples/minimal-agent.js'), join(temp, 'example.js'));
  process.stdout.write(run(process.execPath, ['example.js'], temp));
  await copyFile(join(root, 'packages/task/examples/agent.js'), join(temp, 'task-example.js'));
  process.stdout.write(run(process.execPath, ['task-example.js'], temp));
  // 新模型须从实际安装的公共包导出，并能直接参与提示词编排。
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { RulesModel, fillTemplate, renderSections } from '@agent-modules/prompt-composer';
    const model = new RulesModel({ supports_supplement: true,
      rules: { generate: { base: 'old snapshot', supplement: 'supplement' } } });
    const resolved = model.resolve('generate', 'current base');
    assert.deepEqual(resolved, { base: 'current base', supplement: 'supplement' });
    const prompt = renderSections(fillTemplate({ rules: '{{rules}}' }, { rules: resolved }));
    assert.ok(prompt.includes('current base') && !prompt.includes('old snapshot'));
    assert.deepEqual(new RulesModel(JSON.parse(JSON.stringify(model))).toJSON(), model.toJSON());
  `], temp);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { TaskManager, NodeStateModel } from '@agent-modules/task';
    import { createTaskHistory } from '@agent-modules/task/ui';
    const { JSDOM } = await import(${JSON.stringify(import.meta.resolve('jsdom'))});
    const dom = new JSDOM();
    const manager = new TaskManager({ nodes: { custom: {
      plan: () => [{ kind: 'generate' }], execute: async () => ({ result: 'tarball result' }),
    } } });
    const group = manager.submit('scope', { tasks: [{ node_type: 'custom', metadata: { project_id: 'business' } }] });
    await manager.idle('scope');
    const ui = createTaskHistory({ source: manager.historySource('scope'), nodeTypes: manager.nodeTypes(), document: dom.window.document });
    await ui.ready;
    assert.equal(ui.element.shadowRoot.querySelectorAll('select').length, 2);
    assert.equal(manager.detail('scope', group.group.id).status, 'completed');
    assert.equal(Object.hasOwn(new NodeStateModel(), 'fail_message'), false);
    ui.dispose(); await manager.dispose(); dom.window.close();
  `], temp);
  // DOM 由验证宿主提供；公共 UI 的安装产物不依赖 meiji 或 jsdom。
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { RulesModel } from '@agent-modules/prompt-composer';
    import { renderRulesPanel } from '@agent-modules/prompt-composer/ui';
    const { JSDOM } = await import(${JSON.stringify(import.meta.resolve('jsdom'))});
    const dom = new JSDOM('<main></main>');
    const model = new RulesModel({ supports_supplement: true,
      rules: { generate: { base: 'snapshot', supplement: 'supplement' } } });
    const panel = renderRulesPanel(model, { document: dom.window.document,
      currentBases: { generate: 'current', revise: '', review: '' }, copyText: async () => {} });
    dom.window.document.querySelector('main').append(panel);
    assert.equal(panel.shadowRoot.querySelectorAll('[role=tab]').length, 3);
    assert.equal(panel.shadowRoot.querySelector('[data-field=base] pre').textContent, 'current');
    panel.shadowRoot.querySelectorAll('[role=tab]')[2].click();
    assert.equal(panel.shadowRoot.querySelector('[data-action=review]').hidden, false);
    dom.window.close();
  `], temp);
  // 公共分发不含 meiji 的旧网关兼容模块。
  run(process.execPath, ['--input-type=module', '-e', "const { default: assert } = await import('node:assert/strict'); await assert.rejects(import('@agent-modules/http-client/elysium'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }); await import('@agent-modules/http-client/model-parameters'); await import('@agent-modules/http-client/remote-task');"], temp);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { SettingsModel } from '@agent-modules/setting';
    const spec = { language: { default: 'zh-CN', options: [{ value: 'zh-CN', label: '中文' }] },
      models: { session: { options: [{ value: 'remote', label: '远程' }], default: 'remote' } } };
    const model = new SettingsModel({}, spec);
    assert.equal(model.session.model, 'remote');
    assert.deepEqual(new SettingsModel(JSON.parse(JSON.stringify(model)), spec).toJSON(), model.toJSON());
    const { createSettingsStore } = await import('@agent-modules/setting/store');
    const { renderSettingsPanel } = await import('@agent-modules/setting/ui');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { JSDOM } = await import(${JSON.stringify(import.meta.resolve('jsdom'))});
    const dir = await mkdtemp(join(tmpdir(), 'setting-install-'));
    try {
      const store = createSettingsStore(join(dir, 'settings.json'), { spec, defaults: {} });
      const saved = await store.write({});
      assert.equal(saved.session.model, 'remote');
      const dom = new JSDOM('<main></main>');
      const panel = renderSettingsPanel(spec, { document: dom.window.document, store });
      await panel.ready;
      assert.equal(panel.shadowRoot.querySelector('[name=session]').value, 'remote');
      dom.window.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  `], temp);
  console.log('四个 npm tarball 已在隔离目录离线安装并运行，未引用原工作区源码。');
} finally {
  await rm(temp, { recursive: true, force: true });
}
