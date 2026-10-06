import { buildTextPrompts } from '../../prompts/text-prompts.js'
import { generateStep } from './shared/text-generate.js'

export const promptsForScriptChanges = (project, operation, facts) => buildTextPrompts({ skill: 'script-revision', project, operation, facts })
export const generateScriptChanges = input => generateStep({ ...input, message: input.prompts.generation })
