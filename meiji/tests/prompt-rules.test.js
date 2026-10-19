import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { nodeRoutes } from "../server/http/nodes/index.js";

describe("rule-source", () => {
  const root = new URL('..', import.meta.url).pathname;
  const modelsDir = join(root, 'shared/prompt-models');
  const sources = [
    ...readdirSync(modelsDir).filter(f => f.endsWith('.js')).map(f => join(modelsDir, f)),
    join(root, 'server/http/nodes/video.js'),
  ].map(file => ({ file, text: readFileSync(file, 'utf8') }));

  // 统计规则正文在源码中以字面量出现的次数（双引号与单引号写法）。
  function literalCount(value) {
    const body = JSON.stringify(value).slice(1, -1);
    const forms = new Set([body, body.replace(/\\"/g, '"')]);
    let count = 0;
    for (const { text } of sources) for (const form of forms) count += text.split(form).length - 1;
    return count;
  }

  test('AI节点规则正文只在源码中定义一次', () => {
    const seen = new Map();
    const walk = (value, path) => {
      if (typeof value === 'string') {
        if (value.length >= 30 && !seen.has(value)) seen.set(value, path);
      } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    for (const [business, route] of Object.entries(nodeRoutes)) {
      walk(route.promptModel, `${business}.promptModel`);
      walk(route.rules, `${business}.rules`);
    }
    assert.ok(seen.size > 50);
    const repeated = [...seen].filter(([value]) => literalCount(value) > 1).map(([value, path]) => `${path}: ${value.slice(0, 40)}`);
    assert.deepEqual(repeated, [], '同一规则请定义为常量后引用，不要在多个动作或节点中复制');
  });

  test('程序代码不读取开发文档 dev_docs', () => {
    const files = [];
    const collect = dir => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) collect(path);
        else if (/\.(m?js|cjs|json)$/.test(name)) files.push(path);
      }
    };
    for (const dir of ['server', 'shared', 'client', 'tools']) collect(join(root, dir));
    files.push(join(root, 'index.js'), join(root, 'session.js'));
    const offenders = files.filter(file => readFileSync(file, 'utf8').includes('dev_docs')).map(file => file.slice(root.length));
    assert.deepEqual(offenders, [], 'dev_docs 只给开发者阅读；程序需要的规则写在 server/ 代码中');
  });
});
