import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selector = join(root, 'scripts/project-path.sh');
const projectNames = (await readdir(join(root, 'projects'), { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name);
const plugins = [];
for (const name of projectNames) {
  try { await readFile(join(root, 'projects', name, 'package.json')); plugins.push(name); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const select = (repo, name = '') => spawnSync('bash', ['-c', 'source "$1"; select_project "$2" "$3"', 'select', selector, repo, name], { encoding: 'utf8' });

test('唯一业务项目自动选择，支持复制模板后使用新的项目名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-select-'));
  try {
    await mkdir(join(dir, 'projects/new-agent'), { recursive: true });
    await writeFile(join(dir, 'projects/new-agent/package.json'), '{}');
    const result = select(dir);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'new-agent');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('多项目不猜测，显式选择与目录存在性校验生效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-select-many-'));
  try {
    for (const name of ['one', 'two']) {
      await mkdir(join(dir, 'projects', name), { recursive: true });
      await writeFile(join(dir, 'projects', name, 'package.json'), '{}');
    }
    assert.notEqual(select(dir).status, 0);
    assert.match(select(dir).stderr, /请指定项目/);
    assert.equal(select(dir, 'two').stdout.trim(), 'two');
    assert.match(select(dir, 'missing').stderr, /找不到项目/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('项目参数拒绝目录穿越和绝对路径', () => {
  for (const value of ['../meiji', '/tmp/example', 'a/b', '..']) {
    const result = select(root, value);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /目录名无效/);
  }
});

test('工作区包通过本地源码链接，业务模块能够导入', async () => {
  for (const name of ['http-client', 'prompt-composer', 'setting', 'task']) {
    assert.equal(await realpath(join(root, 'node_modules/@agent-modules', name)), await realpath(join(root, 'packages', name)));
  }
  for (const project of plugins) {
    assert.equal(typeof (await import(pathToFileURL(join(root, 'projects', project, 'index.js')))).apply, 'function');
    assert.equal(typeof (await import(pathToFileURL(join(root, 'projects', project, 'session.js')))).apply, 'function');
  }
});

test('开发钩子覆盖公共包和业务代码，纯文档豁免', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-guard-'));
  const guard = (file) => spawnSync(process.execPath, [join(root, '.claude/guard.mjs'), 'edit'], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: JSON.stringify({ tool_input: { file_path: join(dir, file) } }), encoding: 'utf8',
  });
  try {
    for (const file of ['packages/http-client/src/request.js', 'projects/new-agent/server/index.js', 'projects/new-agent/skills/one/SKILL.md', 'scripts/run.js', 'package.json']) {
      assert.equal(guard(file).status, 2, file);
    }
    for (const file of ['projects/new-agent/README.md', 'projects/new-agent/dev_docs/workflow.md', 'projects/new-agent/docs/a.md', 'packages/http-client/README.md']) {
      assert.equal(guard(file).status, 0, file);
    }
    await mkdir(join(dir, 'docs/plans'), { recursive: true });
    await writeFile(join(dir, 'docs/plans/1020-计划-测试.md'), '# 测试');
    assert.equal(guard('projects/new-agent/server/index.js').status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('项目入口和开发指引的相对路径有效', async () => {
  for (const name of plugins) {
    const project = JSON.parse(await readFile(join(root, 'projects', name, 'package.json'), 'utf8'));
    assert.ok(project.dsh.bundle.patch);
    await readFile(join(root, 'projects', name, project.dsh.bundle.patch));
    await readFile(join(root, 'projects', name, 'AGENTS.md'));
  }
  for (const tool of ['.claude', '.cursor']) assert.equal(await realpath(join(root, tool, 'agent-harness-dev.md')), await realpath(join(root, '.agents/agent-harness-dev.md')));
});


test('业务项目独立：源码、样式、测试和符号链接不得引用其他项目', async () => {
  const projects = join(root, 'projects')
  const owner = file => {
    const path = relative(projects, file)
    if (path.startsWith('..') || path.startsWith('/')) return null
    const name = path.split('/')[0]
    return projectNames.includes(name) ? name : null
  }
  const packageNames = new Map()
  for (const name of plugins) packageNames.set(JSON.parse(await readFile(join(projects, name, 'package.json'), 'utf8')).name, name)
  const scan = async (directory, project) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'docs', 'dev_docs', 'reports'].includes(entry.name)) continue
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = owner(await realpath(file))
        assert.ok(!target || target === project, `跨项目链接：${file}`)
      } else if (entry.isDirectory()) await scan(file, project)
      else if (['.js', '.mjs', '.ts', '.tsx', '.css', '.json', '.yml', '.yaml'].includes(extname(file))) {
        const source = await readFile(file, 'utf8')
        for (const [, spec] of source.matchAll(/['"](\.{1,2}\/[^'"\r\n]+)['"]/g)) {
          const target = owner(resolve(dirname(file), spec))
          assert.ok(!target || target === project, `跨项目路径：${relative(root, file)} → ${spec}`)
        }
        for (const [name, target] of packageNames) {
          if (target === project) continue
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          assert.equal(new RegExp(`['"]${escaped}(?:/[^'"\\r\\n]*)?['"]`).test(source), false, `跨项目包引用：${file} → ${name}`)
        }
      }
    }
  }
  for (const project of projectNames) await scan(join(projects, project), project)
})
