// 职责：拼接使用 Harness 模块加载协议的客户端源码。
import { readFileSync } from 'node:fs'
const modules = ['api/media.js', 'api/projects.js', 'api/directors.js', 'api/settings.js', 'workcard/state.js', 'workcard/styles.js', 'workcard/card.js', 'workbench/styles.js', 'workbench/dialog.js', 'workbench/directors.js', 'workbench/materials.js', 'workbench/preview.js', 'workbench/anchors.js', 'workbench/storyboard.js', 'workbench/delivery.js', 'workbench/projects.js', 'workbench/settings.js', 'workbench/index.js', 'index.js']
// 宿主提供 React 及其模块加载器；直接拼接模块定义，不重复打包运行时。
export function clientSource() {
  const adapter = `function load(id, define) { window.__ModuleLoader__.load({ id, factory: require => { const exports = {}; define(require, exports); return exports } }) }`
  return `(function () {\n${adapter}\n${modules.map(path => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')).join('\n')}\n})()`
}
