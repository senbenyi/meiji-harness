import { readFileSync } from 'node:fs'

const source = new URL('../../schemas/production/novel-output.schema.json', import.meta.url)
const document = JSON.parse(readFileSync(source, 'utf8'))

function localDefinition(ref) {
  const prefix = '#/definitions/'
  if (!ref.startsWith(prefix)) throw new Error(`unsupported production schema reference: ${ref}`)
  const definition = document.definitions[ref.slice(prefix.length)]
  if (!definition) throw new Error(`unknown production schema reference: ${ref}`)
  return definition
}

function resolve(value, stack = []) {
  if (Array.isArray(value)) return value.map((item) => resolve(item, stack))
  if (!value || typeof value !== 'object') return value
  if (value.$ref) {
    if (stack.includes(value.$ref)) throw new Error(`cyclic production schema reference: ${value.$ref}`)
    const { $ref, ...overrides } = value
    return { ...resolve(localDefinition($ref), [...stack, $ref]), ...resolve(overrides, stack) }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, stack)]))
}

function definition(name) {
  const value = document.definitions[name]
  if (!value) throw new Error(`unknown production output schema: ${name}`)
  return resolve(value)
}

export function productionOutputSchema(name) {
  return structuredClone(definition(name))
}

export const NOVEL_SCHEMA_PARTS = {
  citation: definition('citation'),
  shot: definition('shot'),
}

export const NOVEL_SCHEMAS = Object.fromEntries(
  ['summary', 'analysis', 'assets', 'plan', 'script', 'storyboard'].map((name) => [name, definition(name)]),
)
