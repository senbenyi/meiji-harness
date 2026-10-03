// 操作：全片拼接
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { contentNode } from '../../../../shared/drama-model.js'
import { hasFilm } from '../../../../shared/generation-gates.js'
import { concatFilms } from '../../../media/concat-videos.js'

// if (operation.action === 'assemble')
export async function opAssemble(c) {
  let { deps, home, projects, project, trace, note } = c
  const rows = project.shots.items
  if (!hasFilm(project)) {
    throw Object.assign(new Error('请先完成本集全部镜头成片'), { status: 409 })
  }
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
  await mkdir(directory, { recursive: true })
  const inputs = project.shots.items.map(item => join(directory, item.video.content.file || `${item.id}.mp4`))
  const file = `assembly-${randomUUID()}.mp4`
  const output = join(directory, file)
  note('按镜头顺序拼接成片')
  note('文件：server/media/concat-videos.js')
  note('函数：concatFilms')
  note(rows.map(item => item.id).join('、'))
  await (deps.concatFilms || concatFilms)({ inputs, output })
  const episode = project.episodeId ? `${encodeURIComponent(project.episodeId)}/` : ''
  const url = `/plugins/meiji/projects/${encodeURIComponent(project.id)}/films/${episode}assembly?v=${Date.now()}`
  await projects.save(project.id, { assembly: contentNode(project.assembly, { url, file }, { passed: true, failures: [] }) }, { final: true })
  note('全片已拼接')
  return trace
}

export const operations = {
  assemble: { label: '全片拼接', scope: 'episode', agent: true, step: () => ({ kind: 'assemble', target: 'assembly' }), stage: 'episode', run: opAssemble },
}
