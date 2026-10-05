// 操作：删除剧集
import { opProjectDelete } from './operation-project-delete.js'

export const operations = {
  'episode-delete': { label: '删除剧集', scope: 'episode', lock: 'project', agent: false, stage: 'project', run: opProjectDelete },
}
