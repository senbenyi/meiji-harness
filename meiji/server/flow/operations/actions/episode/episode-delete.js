// 操作：删除剧集
import { opProjectDelete } from '../project/project-delete.js'

export const operations = {
  'episode-delete': { label: '删除剧集', scope: 'episode', queue: 'text', agent: false, stage: 'project', run: opProjectDelete },
}
