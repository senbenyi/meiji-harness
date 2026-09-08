import { readFileSync } from 'node:fs'
const modules = ['settings/directors.js', 'media/api.js', 'media/model.js', 'media/card.js', 'projects/index.js', 'index.js']
// The host supplies React and its module loader; concatenate definitions without bundling another runtime.
export function clientSource() {
  return modules.map(path => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8')).join('\n')
}
