// 职责：拼接使用 Harness 模块加载协议的客户端源码。
import { readFileSync } from 'node:fs'
const live = ['api/media.js', 'api/projects.js', 'api/directors.js', 'api/settings.js', 'workcard/state.js', 'workcard/styles.js', 'workcard/card.js', 'commands/creation.js', 'workbench/styles-shell.js', 'workbench/styles-projects.js', 'workbench/styles-detail.js', 'workbench/styles-materials.js', 'workbench/styles-settings.js', 'workbench/styles.js', 'workbench/dialog.js', 'workbench/directors.js', 'workbench/materials.js', 'workbench/preview.js', 'workbench/production-ui.js', 'workbench/segment-editor.js', 'workbench/production-workflow.js', 'workbench/project-generation.js', 'workbench/project-list.js', 'workbench/project-detail.js', 'workbench/settings.js', 'workbench/index.js', 'index.js']
const legacy = ['legacy/delivery.js', 'legacy/project-configuration.js', 'legacy/episode-ui.js', 'legacy/episode-workflow.js', 'legacy/anchors.js', 'legacy/storyboard.js']
// 宿主提供 React 及其模块加载器；直接拼接模块定义，不重复打包运行时。
function bundle(modules) {
  const adapter = `function load(id, define) { window.__ModuleLoader__.load({ id, factory: require => { const exports = {}; define(require, exports); return exports } }) }`
  return `(function () {\n${adapter}\n${modules.map(path => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')).join('\n')}\n})()`
}
export function clientSource() {
  return bundle(live)
}
export function testClientSource() {
  return bundle([...live, ...legacy])
}
