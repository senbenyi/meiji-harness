import { cp, mkdtemp, readFile, writeFile, realpath, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceProject = execFileSync('bash', ['-c', 'source "$1"; select_project "$2" "$3"', 'select', join(root, 'scripts/project-path.sh'), root, process.argv[2] || process.env.AGENT_PROJECT || ''], { encoding: 'utf8' }).trim();
const temp = await mkdtemp(join(tmpdir(), 'agent-harness-copy-'));
const copy = join(temp, 'different-location');
const run = (command, args) => execFileSync(command, args, { cwd: copy, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await cp(root, copy, {
    recursive: true, verbatimSymlinks: true,
    filter(source) {
      const parts = relative(root, source).split(sep);
      return !parts.some(part => ['.git', '.gitnexus', 'node_modules', 'reports', '.DS_Store'].includes(part))
        && !source.endsWith('models.local.json');
    },
  });
  // 模拟复制模板后只改 projects：改业务目录和包名，根脚本不编辑。
  const copiedProject = sourceProject === 'copied-agent' ? 'verification-agent' : 'copied-agent';
  await rename(join(copy, 'projects', sourceProject), join(copy, 'projects', copiedProject));
  const projectFile = join(copy, 'projects', copiedProject, 'package.json');
  const project = JSON.parse(await readFile(projectFile, 'utf8'));
  project.name = '@example/copied-agent';
  await writeFile(projectFile, JSON.stringify(project, null, 2) + '\n');
  // 项目清单变化后由 npm 更新锁文件；随后验证干净安装。
  run('npm', ['install', '--package-lock-only', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  for (const name of ['http-client', 'prompt-composer', 'task']) {
    assert.equal(await realpath(join(copy, 'node_modules/@agent-modules', name)), await realpath(join(copy, 'packages', name)));
  }
  run(process.execPath, ['--input-type=module', '-e', `await import('./projects/${copiedProject}/index.js'); await import('./projects/${copiedProject}/session.js');`]);
  const selected = run('bash', ['-c', 'source scripts/project-path.sh; select_project "$PWD" "$1"', 'select', copiedProject]);
  assert.equal(selected.trim(), copiedProject);
  run(process.execPath, ['--test', 'scripts/tests/workspace.test.js']);
  process.stdout.write(run('npm', ['run', 'example']));
  process.stdout.write(run('npm', ['run', 'example:task']));
  console.log('复制验收通过：不同目录、修改项目目录与包名、离线 npm ci、公共包本地链接及插件入口导入。');
} finally {
  await rm(temp, { recursive: true, force: true });
}
