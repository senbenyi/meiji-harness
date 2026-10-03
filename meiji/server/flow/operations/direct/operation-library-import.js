// 操作：导入素材
import { rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { openIncoming } from '../shared/incoming.js'

// if (operation.action === 'library-import')
export async function opLibraryImport(c) {
  let { operation, home, library, trace, note } = c
  const incoming = await openIncoming(home, operation.incomingId)
  const metadata = await library.import(operation.category, operation.name, createReadStream(incoming.file), undefined, { guidanceType: operation.guidanceType })
  await rm(incoming.directory, { recursive: true, force: true })
  note(`已导入素材 ${metadata.originalName} 到${operation.category}`)
  note(`素材编号 ${metadata.id}`)
  return trace
}

export const operations = {
  'library-import': { label: '导入素材', scope: 'project', queue: 'text', agent: false, stage: 'pre', run: opLibraryImport },
}
