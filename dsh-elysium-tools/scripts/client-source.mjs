import { readFileSync } from 'node:fs'
const modules = ['media/api.js', 'media/model.js', 'media/styles.js', 'media/card.js', 'media/results.js', 'creation-commands.js', 'panel/panel-styles.js', 'panel/asset-list.js', 'panel/storyboard.js', 'panel/asset-panel.js', 'index.js']
// The host supplies React and its module loader; concatenate definitions without bundling another runtime.
export function clientSource() {
  return modules.map(path => {
    const source = readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')
    // Adapt named CommonJS definitions to the host's object-based loader contract.
    return path.startsWith('panel/') ? source.replace(/window\.__ModuleLoader__\.load\('([^']+)', \(require, exports\) => \{/, "window.__ModuleLoader__.load({ id: '$1', factory: require => { const exports = {}")
      .replace(/\}\)\s*$/, 'return exports\n} })\n') : source
  }).join('\n')
}
