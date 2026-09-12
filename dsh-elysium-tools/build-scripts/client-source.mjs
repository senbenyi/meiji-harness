import { readFileSync } from 'node:fs'
const modules = ['media/api.js', 'media/model.js', 'media/styles.js', 'media/card.js', 'media/results.js', 'creation-commands.js', 'index.js']
// The host supplies React and its module loader; concatenate definitions without bundling another runtime.
export function clientSource() {
  return modules.map(path => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')).join('\n')
}
