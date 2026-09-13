// 职责：拼接客户端模块，并适配 Harness 的模块加载协议。
import { readFileSync } from 'node:fs'
const modules = ['media/api.js', 'media/task-state.js', 'media/styles.js', 'media/task-card.js', 'media/conversation-results.js', 'commands/creation.js', 'workbench/styles.js', 'workbench/dialog.js', 'workbench/project-api.js', 'workbench/materials.js', 'workbench/shot-preview.js', 'workbench/project-picker.js', 'workbench/anchors.js', 'workbench/storyboard.js', 'workbench/delivery.js', 'workbench/projects.js', 'workbench/index.js', 'index.js']
// 宿主提供 React 及其模块加载器；直接拼接模块定义，不重复打包运行时。
export function clientSource() {
  return modules.map(path => {
    const source = readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')
    // 将具名 CommonJS 定义适配为宿主的对象式加载协议。
    return path.startsWith('workbench/') ? source.replace(/window\.__ModuleLoader__\.load\('([^']+)', \(require, exports\) => \{/, "window.__ModuleLoader__.load({ id: '$1', factory: require => { const exports = {}")
      .replace(/\}\)\s*$/, 'return exports\n} })\n') : source
  }).join('\n')
}
