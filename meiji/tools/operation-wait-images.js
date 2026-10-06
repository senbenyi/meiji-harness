import { jsonOutput, sessionIdOf, currentProject } from './operation-context-query.js'

export function waitImagesTool({ home, jobs }) {
  return { name: 'operation-wait-images', description: '等待指定剧集卡片的图片全部确认，返回等待 job。取消等待不会改图片。', parameters: { type: 'object', additionalProperties: false, required: ['episodeNumber'], properties: { episodeNumber: { type: 'integer', minimum: 1 }, itemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true } } }, output: jsonOutput,
    async execute(args, exec) { const project = await currentProject(home, exec), episode = [...project.episodes].reverse()[args.episodeNumber - 1]; if (!Number.isInteger(args.episodeNumber) || !episode) throw new Error('目标剧集不存在'); return JSON.stringify(jobs.waitImages(project.id, episode.id, args.itemIds, sessionIdOf(exec))) } }
}
