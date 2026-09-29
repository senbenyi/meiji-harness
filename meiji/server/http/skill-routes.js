// 技能接口（只供面板，同源请求；会话 agent 没有对应工具，不能修改技能）：
//   GET  /skills                       技能库：全部技能与修改状态
//   GET  /skills/<id>                  详情：各字段（内置 / 基础）、协议、适用指导；带 sessionId+projectId 时附本剧补充、启用的指导与素材
//   PUT  /skills/<id>                  保存基础（替换内置，对所有剧生效；须带 confirm: true）
//   POST /skills/<id>/reset            恢复内置（to: builtin）或撤回上一版（to: previous）
//   POST /skills/<id>/preview          生成 / 意见修改 / 审核 / 自动修订请求的组装预览（分段、来源、字数），不调用模型
//   PUT  /project-skills               本剧补充 { sessionId, projectId, skill, fields }
//   PUT  /project-guidance             本剧启用的指导 { enabled } 与某阶段的指导素材 { stage, guidanceAssetIds }
import { builtinSkill, guidanceName, guidanceSkillIds } from '../../skills/load.js'
import { editableFields, additionsPatch, guidancePatch, loadSkillSet, projectSkills, skillStore } from '../data/skill-store.js'
import { assetsPatch, loadGuidanceAssets } from '../data/custom-skills.js'
import { materialize } from '../data/episodes.js'
import { previewPrompts } from '../prompts/preview.js'

const sameOrigin = req => req.headers['x-meiji-request'] === '1'

function summary(skill) {
  return { id: skill.id, kind: skill.kind, label: skill.label, panel: skill.panel || null, output: skill.output || null,
    modified: Object.entries(skill.layers).filter(([, layer]) => layer === 'base').map(([field]) => field), outdated: skill.outdated, updatedAt: skill.updatedAt }
}

function detail(skill) {
  const fields = editableFields(skill).map(field => ({ field, text: skill.parts[field], builtin: skill.builtin[field], layer: skill.layers[field], outdated: skill.outdated.includes(field), previous: skill.previous.includes(field) }))
  const meta = builtinSkill(skill.id)
  const guidance = meta.kind === 'stage' && meta.guidanceStage
    ? guidanceSkillIds().map(builtinSkill).filter(item => item.stages[meta.guidanceStage]).map(item => ({ id: item.id, name: guidanceName(item.id), label: item.label, placement: item.stages[meta.guidanceStage], defaultEnabled: item.defaultEnabled, assetTypes: item.assetTypes }))
    : []
  const stages = meta.kind === 'guidance' ? Object.entries(meta.stages).map(([stage, placement]) => ({ stage, placement })) : []
  return { ...summary(skill), fields, protocol: meta.protocol || '', guidance, stages, assetStages: meta.assetStages || [], related: meta.related || [] }
}

export function skillRoutes({ home, projects, links, json, readJson }) {
  const store = skillStore(home)
  const projectPart = (project, id) => {
    const skills = projectSkills(project.skills)
    return { additions: skills.additions[id] || {}, enabled: skills.guidance.enabled, assets: skills.assets }
  }
  return async (req, res, url, base) => {
    const path = url.pathname
    if (path === base + '/skills') {
      if (req.method !== 'GET') return json(res, 405, { error: '不支持的请求' })
      return json(res, 200, { skills: (await store.list()).map(summary) })
    }
    if (path === base + '/project-skills' || path === base + '/project-guidance') {
      if (req.method !== 'PUT') return json(res, 405, { error: '不支持的请求' })
      if (!sameOrigin(req)) return json(res, 403, { error: '需要同源请求' })
      const body = await readJson(req, path.endsWith('skills') ? 200000 : 8192)
      await links.requireProject(String(body.sessionId || ''), body.projectId)
      if (path.endsWith('skills')) {
        const saved = await projects.save(body.projectId, current => ({ skills: additionsPatch(current.skills, String(body.skill || ''), body.fields) }))
        return json(res, 200, { project: saved, skills: projectPart(saved, body.skill) })
      }
      const assets = body.stage === undefined ? undefined : await loadGuidanceAssets(home, body.guidanceAssetIds || [])
      const saved = await projects.save(body.projectId, current => {
        let patch = {}
        if (body.enabled !== undefined) patch.skills = guidancePatch(current.skills, body.enabled)
        if (assets !== undefined) patch = { ...patch, ...assetsPatch({ ...current, skills: patch.skills || current.skills }, body.stage, assets) }
        return patch
      })
      return json(res, 200, { project: saved })
    }
    const match = path.match(new RegExp('^' + base + '/skills/([a-z0-9-]+)(/reset|/preview)?$'))
    if (!match) return false
    const id = match[1]
    if (!match[2]) {
      if (req.method === 'GET') {
        const skill = detail(await store.get(id))
        const projectId = url.searchParams.get('projectId')
        if (!projectId) return json(res, 200, { skill })
        await links.requireProject(url.searchParams.get('sessionId'), projectId)
        return json(res, 200, { skill, project: projectPart(await projects.read(projectId), id) })
      }
      if (req.method !== 'PUT') return json(res, 405, { error: '不支持的请求' })
      if (!sameOrigin(req)) return json(res, 403, { error: '需要同源请求' })
      const body = await readJson(req, 400000)
      if (body.confirm !== true) return json(res, 400, { error: '保存基础 skill 会对所有剧生效，请确认后再保存' })
      return json(res, 200, { skill: detail(await store.save(id, body.fields)) })
    }
    if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求' })
    if (!sameOrigin(req)) return json(res, 403, { error: '需要同源请求' })
    const body = await readJson(req, 8192)
    if (match[2] === '/reset') return json(res, 200, { skill: detail(await store.reset(id, { to: body.to, field: body.field || '' })) })
    // 预览：可不带项目（只看内置 + 基础）；带项目时叠加本剧并使用该集的实际上下文。
    let root = null, view = null
    if (body.projectId) {
      await links.requireProject(String(body.sessionId || ''), body.projectId)
      root = await projects.read(body.projectId)
      view = body.episodeId ? materialize(root, body.episodeId) : null
    }
    const skillSet = await loadSkillSet(home, root?.skills)
    const requests = previewPrompts({ stage: id, root: root || { title: '', summary: { content: '' }, episodes: [] }, view, skillSet, mode: body.mode === 'text' ? 'text' : 'reference' })
    return json(res, 200, { requests })
  }
}
