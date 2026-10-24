import { join } from 'node:path'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { NodeStateModel } from '@agent-modules/task/models'
import { ProjectManager } from '../../project_runtime/project_manager.js'
import { nodeRules } from '../../node_runtime/node_state.js'
import { waitBoxTask, boxReport } from '../../node_runtime/box_report.js'
import { groupOutput } from '../group_setting/state.js'
import { digest, reconcileCharacterAssets } from '../character_extraction/state.js'
import { imageTargets, imageFingerprint } from './state.js'
import { CostumeImageExecutor } from './executor.js'

export class CostumeImageService {
  constructor({ projects, records, models }) {
    Object.assign(this, { projects, records, models })
    projects.enableTaskRecords(records)
    this.executor = new CostumeImageExecutor({ projects, records, models, save: (...args) => this.save(...args) })
  }

  generate({ instruction = '生成角色定妆照', character_id, costume_id, retry_of } = {}, { sessionId, projectId, requestId, source = 'ui', retryAction } = {}) {
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 10000 || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new TypeError('缺少有效的定妆要求或请求ID')
    if (character_id !== undefined && (typeof character_id !== 'string' || !character_id)) throw new TypeError('角色ID无效')
    if (costume_id !== undefined && costume_id !== null && (typeof costume_id !== 'string' || !costume_id)) throw new TypeError('服装ID无效')
    if (costume_id !== undefined && !character_id) throw new TypeError('指定服装时需要明确角色')
    return this.projects.writes.run(async () => {
      const { project } = await this.projects.snapshot(sessionId)
      if (!project || projectId && project.basic_info.id !== projectId) throw Object.assign(new Error('当前会话未绑定此项目'), { code: 'PROJECT_SCOPE' })
      projectId = project.basic_info.id
      if (retry_of) {
        const parent = this.records.tasks.detail(this.records.scope, retry_of)
        if (!parent || parent.tasks[0].node_type !== 'costume_image' || parent.tasks[0].metadata.session_id !== sessionId || parent.tasks[0].metadata.project_id !== projectId || parent.tasks.some(task => ['queued', 'running'].includes(task.task_status))) throw new Error('原定妆照任务不属于当前项目或尚未结束')
        if (retryAction !== 'regenerate' || source !== 'ui') throw new Error('请在角色页或任务卡片选择重新生成')
        character_id = parent.tasks[0].metadata.selection.character_id
        costume_id = parent.tasks[0].metadata.selection.costume_id
        instruction = parent.tasks[0].metadata.instruction
      }
      const id = digest(['costume_image', sessionId, requestId]), signature = digest({ instruction, character_id, costume_id, retry_of })
      const old = this.records.tasks.detail(this.records.scope, id)
      if (old) {
        if (old.tasks[0].metadata.request_signature !== signature) throw new Error('同一请求ID不能用于不同定妆要求')
        return { project_id: projectId, group_id: id, status: old.status }
      }
      if (this.projects.activeExecution(projectId)) throw Object.assign(new Error('该项目已有排队或执行中的任务'), { code: 'PROJECT_ACTIVE' })
      if (project.character_extraction.node_state.status !== 'generated') throw new Error('请先生成并确认角色资料')
      if (project.group_setting?.node_state.status !== 'generated') throw new Error('请先完成并确认团队设定')
      project.character_extraction.assets = await reconcileCharacterAssets(project.character_extraction.assets, project.character_extraction.characters, project.character_extraction.characters, groupOutput(project).groups, groupOutput(project).groups)
      const targets = imageTargets(project, character_id, costume_id)
      if (!targets.length) throw new Error('没有可生成定妆照的角色或服装')
      const manager = await ProjectManager.open(join(this.projects.root, 'projects', projectId, 'project.json'))
      manager.change(next => { next.character_extraction.assets = project.character_extraction.assets }); await manager.model.update()
      const config = await this.models.read()
      this.records.tasks.submit(this.records.scope, { group: { id, name: character_id ? '生成角色定妆照' : '一键生成所有角色定妆照', source, metadata: { project_id: projectId, notify_main: source === 'ui', parent_group_id: retry_of || null } },
        tasks: targets.map(target => ({ node_type: 'costume_image', action: target.image.address ? 'revise' : 'generate', name: `${target.character.name} · ${target.costume?.name || '人物定妆照'}`,
          metadata: { project_id: projectId, project_name: project.basic_info.name, session_id: sessionId, request_id: requestId, request_signature: signature, parent_group_id: retry_of || null, selection: { ...(character_id ? { character_id } : {}), ...(costume_id !== undefined ? { costume_id } : {}) },
            character_id: target.character.id, costume_id: target.costume?.id ?? null, instruction, goal: instruction, input_hash: imageFingerprint(project, target),
            input_snapshot: { character: target.character, costume: target.costume, groups: target.groups, reference_image: target.image.reference_image,
              aspect_ratio: '3:4', instruction, output_language: config.output_language, rules: nodeRules(target.image.node_state) } } })) })
      this.projects.watchProjectTask(id)
      return { project_id: projectId, group_id: id, status: 'queued' }
    }).then(async result => { if (source === 'ui') await this.projects.showPanelTaskStart?.(result.group_id); this.records.tasks.start(this.records.scope); return result })
  }

  async wait(groupId, sessionId, signal) {
    const detail = this.records.tasks.detail(this.records.scope, groupId)
    if (!detail || detail.tasks[0].node_type !== 'costume_image' || detail.tasks[0].metadata.session_id !== sessionId) throw Object.assign(new Error('任务不属于当前会话'), { code: 'PROJECT_SCOPE' })
    const report = await waitBoxTask(this.records, groupId, signal)
    await this.projects.writes.run(() => {})
    const final = boxReport(this.records.tasks.detail(this.records.scope, groupId))
    return { ...report, ...final }
  }

  save(ctx, bytes) {
    return this.projects.writes.run(async () => {
      ctx.signal.throwIfAborted()
      const metadata = ctx.task.metadata, { project } = await this.projects.snapshot(metadata.session_id)
      if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目归属已变化')
      const target = imageTargets(project, metadata.character_id, metadata.costume_id)[0]
      if (!target || imageFingerprint(project, target) !== metadata.input_hash) throw new Error('角色、服装或照片规则已变化，请重新生成')
      const detail = this.records.tasks.detail(this.records.scope, ctx.task.group_id)
      if (detail.tasks.find(task => task.id === ctx.task.id)?.task_status !== 'running') throw new Error('任务已结束，拒绝写入')
      const filename = `${ctx.task.id}-${ctx.step.id}.png`, folder = join(this.projects.root, 'projects', metadata.project_id, 'costume-images')
      await mkdir(folder, { recursive: true }); await writeFile(join(folder, filename), bytes)
      const address = `/api/drama/costume-image?${new URLSearchParams({ session_id: metadata.session_id, file: filename })}`
      const manager = await ProjectManager.open(join(this.projects.root, 'projects', metadata.project_id, 'project.json'))
      manager.change(next => {
        const image = imageTargets(next, metadata.character_id, metadata.costume_id)[0].image
        image.address = address; image.aspect_ratio = metadata.input_snapshot.aspect_ratio
        image.node_state = new NodeStateModel({ ...image.node_state, status: 'generated', reason: '', dependency_hash: metadata.input_hash }).toJSON()
        if (image.node_state.opinion?.trim() === metadata.instruction.trim()) image.node_state.opinion = ''
      })
      ctx.signal.throwIfAborted(); await manager.model.update()
      this.projects.emit('updated', { project_id: metadata.project_id, session_ids: [metadata.session_id] })
      return { address }
    })
  }

  async readImage(sessionId, filename) {
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename || '')) throw new TypeError('图片文件名无效')
    const { project } = await this.projects.snapshot(sessionId)
    if (!project) throw Object.assign(new Error('当前会话未绑定项目'), { code: 'PROJECT_SCOPE' })
    return readFile(join(this.projects.root, 'projects', project.basic_info.id, 'costume-images', filename))
  }
}
