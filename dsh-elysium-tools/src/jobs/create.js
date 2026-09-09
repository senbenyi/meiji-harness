import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { requiredConfig } from '../config.js'
import { saveJson } from './json.js'
import { bindVideoCall } from './call-index.js'

export async function createJob(plan, exec) {
  const id = randomBytes(16).toString('hex')
  await saveJson(join(requiredConfig('ELYSIUM_TOOLS_STATE_ROOT'), 'jobs', id, 'input/request.json'), plan)
  await bindVideoCall(id, exec)
  return id
}
