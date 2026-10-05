// 从素材库移除；已有项目和历史记录仍通过原 ID 读取文件。
export async function opLibraryDelete({ operation, library, trace, note }) {
  try { await library.remove(operation.category, operation.assetId) }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('素材不存在'), { status: 404 })
    throw error
  }
  note('已从素材库移除，项目已有引用保留')
  return trace
}

export const operations = {
  'library-delete': { label: '删除素材', scope: 'project', agent: false, stage: 'pre', run: opLibraryDelete },
}
