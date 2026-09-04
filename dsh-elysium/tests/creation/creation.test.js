import test from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createCreationService } from '../../src/application/creation-service.js'
import { findDirector, listDirectors, mergePlanningProfile } from '../../src/application/directors.js'
import { DIRECTOR_PROFILE } from '../../src/application/director-profile.js'
import { assertAmbientSoundOnly, deriveEpisodeId, storyHashOf } from '../../src/domain/creation.js'
import { validateCompliance } from '../../src/domain/episode.js'

const COMPLIANCE = {
  fictional_adults_only: true,
  all_participants_18_or_older: true,
  consensual_content: true,
  rights_confirmed: true,
}

function fakePlanner() {
  const calls = []
  return {
    calls,
    async plan(body) {
      calls.push(body)
      const count = Math.max(1, Math.ceil(body.targetDurationSec / 20))
      const chapters = Array.from({ length: count }, (_, chapterIndex) => ({
        id: `chapter-${String(chapterIndex + 1).padStart(2, '0')}`,
        order: chapterIndex + 1,
        title: `第 ${chapterIndex + 1} 章`,
        summary: `第 ${chapterIndex + 1} 章发生的事`,
        sceneIds: ['scene-01'],
        soundPrompt: 'planner generated ambient bed',
        anchors: Array.from({ length: 6 }, (_, anchorIndex) => ({
          id: `chapter-${String(chapterIndex + 1).padStart(2, '0')}-anchor-${String(anchorIndex + 1).padStart(2, '0')}`,
          order: anchorIndex + 1,
          role: anchorIndex === 0 ? 'start' : 'continuation',
          imagePrompt: `第 ${chapterIndex + 1} 章第 ${anchorIndex + 1} 个锚点的首帧画面`,
          motionPrompt: `第 ${chapterIndex + 1} 章第 ${anchorIndex + 1} 个锚点的运动`,
        })),
      }))
      return {
        plan: { schemaVersion: 'elysium-plan-2', episodeId: body.episodeId, source: 'producer-agent', chapters },
        script: { schemaVersion: 'elysium-script-2', source: 'producer-agent', synopsis: '梗概', scenes: [] },
        assets: [{ id: 'cast-main', type: 'character', name: '角色定妆表', prompt: '定妆', status: 'prompt_ready' }],
      }
    },
  }
}

/** 40 秒 ⇒ 2 章；步骤结果按这个章节数构造。 */
function stepValues(chapterCount = 2) {
  return [
    [1, { genre: '都市情感', audience: '成年观众', takeaway: '一次没能说出口的告别' }],
    [2, { durationSec: chapterCount * 20 }],
    [3, { intensity: '中等，情绪为主', avoidList: ['血腥'], compliance: COMPLIANCE }],
    [4, [
      { name: '林岸', age: 29, gender: '女', appearance: '短发，雨衣', clothing: '深蓝雨衣', personality: '克制' },
      { name: '周叙', age: 34, gender: '男', appearance: '高个，眼镜', clothing: '灰色风衣', personality: '迟疑' },
    ]],
    [5, [{ from: '林岸', to: '周叙', type: '旧同事', tension: '未说明的亏欠' }]],
    [6, { theme: '错过', logline: '两个人在雨夜的码头把话说完' }],
    [7, { external: '末班船只等十分钟', internal: '谁先承认自己后悔', choice: '上船还是留下' }],
    [8, { synopsis: '林岸在码头等到周叙，两人把三年前没说完的话说完，末班船开走。' }],
    [9, [
      { title: '码头等待', location: '雾港码头', timeOfDay: '夜', characters: ['林岸'], summary: '林岸独自等待', dialogue: [] },
      { title: '重逢', location: '雾港码头', timeOfDay: '夜', characters: ['林岸', '周叙'], summary: '周叙出现，两人对话', dialogue: [{ speaker: '周叙', line: '你还在等。' }] },
    ]],
    [10, [
      { sceneId: 'scene-01', intensity: 3, emotionStart: '空', emotionEnd: '期待' },
      { sceneId: 'scene-02', intensity: 6, emotionStart: '期待', emotionEnd: '释然' },
    ]],
    [11, Array.from({ length: chapterCount }, (_, index) => ({
      title: `第 ${index + 1} 章`,
      summary: `第 ${index + 1} 章的具体事件`,
      sceneIds: [index === 0 ? 'scene-01' : 'scene-02'],
    }))],
    [12, Array.from({ length: chapterCount }, (_, index) => ({
      beats: [`第 ${index + 1} 章的推进点`],
      performanceNotes: ['反应先于台词'],
      continuity: { positions: { 林岸: 'left' } },
    }))],
    [13, Array.from({ length: chapterCount }, (_, index) => ({
      soundPrompt: `harbor water lapping, distant foghorn, footsteps on wet planks, chapter ${index + 1}`,
    }))],
  ]
}

async function fixture(t, { chapterCount = 2 } = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-creation-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const planner = fakePlanner()
  const service = createCreationService({ workspace }, planner)
  const created = await service.createProject({ title: '雾港来信', directorId: 'kokoro-realism' })
  return { workspace, planner, service, projectId: created.project.id, created, chapterCount }
}

async function runAllSteps(service, projectId, chapterCount = 2) {
  for (const [index, value] of stepValues(chapterCount)) {
    await service.saveStep({ projectId, index, value })
    await service.confirmStep({ projectId, index })
  }
}

// ── 导演配置 ────────────────────────────────────────────────────────────────

test('导演目录只对外暴露展示字段，不外泄人格提示词', () => {
  const listed = listDirectors()
  assert.equal(listed.length, 5)
  for (const director of listed) {
    assert.ok(director.schoolName && director.inspiredBy && director.disclaimer)
    assert.match(director.disclaimer, /未获得任何真实人士授权或背书/)
    assert.equal(director.identityPrompt, undefined)
    assert.equal(director.personaPrompt, undefined)
    assert.equal(director.planningOverrides, undefined)
  }
  assert.deepEqual([...new Set(listed.map(item => item.id))].length, 5)
})

test('导演版本缺失时如实上报回退，不静默换版本', () => {
  const exact = findDirector('kokoro-realism', '2026-09-04.1')
  assert.equal(exact.fallback, false)
  const stale = findDirector('kokoro-realism', '1999-01-01.1')
  assert.equal(stale.fallback, true)
  assert.equal(stale.director.version, '2026-09-04.1')
  assert.equal(findDirector('nobody').director, undefined)
})

test('导演参数覆盖全局分镜方法论', () => {
  const { director } = findDirector('docu-road')
  const merged = mergePlanningProfile(DIRECTOR_PROFILE, director)
  assert.equal(merged.camera.motionPreference, 'handheld follow, walking pace tracking')
  assert.equal(merged.pacing.emotionScale, DIRECTOR_PROFILE.pacing.emotionScale)
  assert.equal(merged.consistency.negativePromptBase, DIRECTOR_PROFILE.consistency.negativePromptBase)
})

// ── 项目与会话绑定 ──────────────────────────────────────────────────────────

test('创新项目落库导演 ID 与版本，并给出开场提示词', async (t) => {
  const { workspace, created, projectId } = await fixture(t)
  const project = JSON.parse(await readFile(path.join(workspace, 'projects', projectId, 'project.json'), 'utf8'))
  assert.equal(project.kind, 'creative')
  assert.equal(project.directorId, 'kokoro-realism')
  assert.equal(project.directorVersion, '2026-09-04.1')
  assert.match(created.openingPrompt, /真实交流派/)
  assert.match(created.openingPrompt, /未获得任何真实人士授权或背书/)
  assert.match(created.openingPrompt, /不生成对白、旁白、TTS 或音乐|不承诺对白配音/)
  assert.equal(created.skill, 'elysium-story')
})

test('未知导演拒绝建项目', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-creation-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const service = createCreationService({ workspace }, fakePlanner())
  await assert.rejects(service.createProject({ title: 'x', directorId: 'not-a-director' }), /导演配置不存在/)
})

test('会话绑定幂等，换会话则拒绝', async (t) => {
  const { service, projectId } = await fixture(t)
  const first = await service.bindSession({ projectId, conversationId: 'session-1', conversationTitle: '真实交流派-雾港来信' })
  assert.equal(first.creation.status, 'conversation_created')
  const again = await service.bindSession({ projectId, conversationId: 'session-1', skillLoaded: true })
  assert.equal(again.creation.conversationId, 'session-1')
  assert.equal(again.creation.status, 'skill_loaded')
  await assert.rejects(service.bindSession({ projectId, conversationId: 'session-2' }), /已经绑定了另一条创作会话/)
})

// ── 15 步纪律 ───────────────────────────────────────────────────────────────

test('保存某一步会把它之后所有已确认步降级', async (t) => {
  const { service, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const before = await service.getState({ projectId })
  assert.deepEqual(before.creation.steps.filter(step => step.index <= 13 && step.status !== 'confirmed'), [])

  const updated = await service.saveStep({ projectId, index: 6, value: { theme: '和解', logline: '两个人把话说完' } })
  const later = updated.creation.steps.filter(step => step.index > 6 && step.index <= 13)
  assert.ok(later.every(step => step.status !== 'confirmed'), '第 6 步之后不应还有已确认步')
  assert.equal(updated.creation.steps.find(step => step.index === 5).status, 'confirmed')
  assert.equal(updated.creation.storyDraft, null)
})

test('未确认完 13 步不能汇总', async (t) => {
  const { service, projectId } = await fixture(t)
  await service.saveStep({ projectId, index: 1, value: { takeaway: '目标' } })
  await assert.rejects(service.compileStory({ projectId }), /尚未确认/)
})

test('乐观锁挡住并发覆盖', async (t) => {
  const { service, projectId } = await fixture(t)
  await service.saveStep({ projectId, index: 1, value: { takeaway: '第一版' } })
  await assert.rejects(
    service.saveStep({ projectId, index: 1, value: { takeaway: '第二版' }, expectedRevision: 0 }),
    /已被更新/,
  )
})

// ── 硬约束 ──────────────────────────────────────────────────────────────────

test('角色年龄必须是具体整数且不小于 18', async (t) => {
  const { service, projectId } = await fixture(t)
  await assert.rejects(
    service.saveStep({ projectId, index: 4, value: [{ name: '林岸', age: '二十岁左右', appearance: '短发' }] }),
    /必须是具体的整数年龄/,
  )
  await assert.rejects(
    service.saveStep({ projectId, index: 4, value: [{ name: '林岸', age: 17, appearance: '短发' }] }),
    /不小于 18/,
  )
  const ok = await service.saveStep({ projectId, index: 4, value: [{ name: '林岸', age: 29, appearance: '短发' }] })
  assert.equal(ok.creation.steps.find(step => step.index === 4).value[0].age, 29)
})

test('内容尺度必须四项合规全部由用户确认', async (t) => {
  const { service, projectId } = await fixture(t)
  await assert.rejects(
    service.saveStep({ projectId, index: 3, value: { intensity: '中等', compliance: { ...COMPLIANCE, consensual_content: false } } }),
    /consensual_content 必须由用户明确确认为 true/,
  )
})

test('章节数必须等于目标时长推导出的章节数', async (t) => {
  const { service, projectId } = await fixture(t)
  await service.saveStep({ projectId, index: 2, value: { durationSec: 40 } })
  await service.confirmStep({ projectId, index: 2 })
  await assert.rejects(
    service.saveStep({ projectId, index: 11, value: [{ title: '唯一一章', summary: '全部剧情', sceneIds: ['scene-01'] }] }),
    /章节数必须是 2/,
  )
})

test('环境音提示词拒绝对白、旁白、配音和音乐', () => {
  for (const bad of ['soft piano music', 'add a voice-over here', 'narration over the harbor', '加一段旁白', '背景音乐渐入', 'TTS reading the letter']) {
    assert.throws(() => assertAmbientSoundOnly(bad, 'soundPrompt'), /只能描述可听见的环境音与拟音/, `应拒绝：${bad}`)
  }
  const good = 'harbor water lapping, distant foghorn, footsteps on wet planks'
  assert.equal(assertAmbientSoundOnly(good, 'soundPrompt'), good)
})

test('环境音步骤在写入时就被拦下', async (t) => {
  const { service, projectId } = await fixture(t)
  await service.saveStep({ projectId, index: 2, value: { durationSec: 40 } })
  await service.confirmStep({ projectId, index: 2 })
  await assert.rejects(
    service.saveStep({ projectId, index: 13, value: [{ soundPrompt: 'rain and music' }, { soundPrompt: 'rain' }] }),
    /只能描述可听见的环境音与拟音/,
  )
})

test('情绪落差超过导演上限必须写明依据', async (t) => {
  const { service, projectId } = await fixture(t)
  await assert.rejects(
    service.saveStep({ projectId, index: 10, value: [{ sceneId: 'scene-01', intensity: 1 }, { sceneId: 'scene-02', intensity: 9 }] }),
    /超过导演上限 3/,
  )
  const ok = await service.saveStep({
    projectId,
    index: 10,
    value: [{ sceneId: 'scene-01', intensity: 1 }, { sceneId: 'scene-02', intensity: 9, note: '剧本在此处发生死讯揭露' }],
  })
  assert.equal(ok.creation.steps.find(step => step.index === 10).value[1].intensity, 9)
})

// ── 剧情确认协议 ────────────────────────────────────────────────────────────

test('剧情指纹只跟内容有关，与保存次数无关', async (t) => {
  const { service, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const first = await service.compileStory({ projectId })
  const second = await service.compileStory({ projectId })
  assert.equal(first.creation.storyHash, second.creation.storyHash)
  assert.equal(second.creation.storyVersion, 2)
  assert.match(first.creation.storyHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(deriveEpisodeId(first.creation.storyHash), /^episode-[0-9a-f]{12}$/)
})

test('确认剧情要求指纹匹配且四项合规为真', async (t) => {
  const { service, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  const storyHash = compiled.creation.storyHash

  await assert.rejects(service.approveStory({ projectId, storyHash: 'sha256:deadbeef' }), /剧情在确认期间发生了变化/)
  await assert.rejects(
    service.approveStory({ projectId, storyHash, compliance: { ...COMPLIANCE, rights_confirmed: false } }),
    /rights_confirmed 必须由用户明确确认为 true/,
  )

  const approved = await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE, confirmedBy: '测试' })
  assert.equal(approved.creation.status, 'story_approved')
  assert.equal(approved.creation.approval.storyHash, storyHash)
  assert.equal(approved.creation.approval.confirmedBy, '测试')

  // 重复确认同一份剧情返回既有记录，不产生第二条。
  const again = await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE })
  assert.equal(again.creation.approval.confirmedAt, approved.creation.approval.confirmedAt)
})

test('定稿后不能直接改步骤，必须先退回创作', async (t) => {
  const { service, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  await service.approveStory({ projectId, storyHash: compiled.creation.storyHash, compliance: COMPLIANCE })

  await assert.rejects(service.saveStep({ projectId, index: 8, value: { synopsis: '换一个梗概' } }), /剧情已定稿/)
  const reopened = await service.reopenStory({ projectId, reason: '要改结尾' })
  assert.equal(reopened.creation.status, 'story_developing')
  assert.equal(reopened.creation.approval, null)
  await service.saveStep({ projectId, index: 8, value: { synopsis: '换一个梗概，末班船没有开走。' } })
})

// ── 同步到制作流程 ──────────────────────────────────────────────────────────

test('确认后同步一次建一个单集，重复点击不重复建', async (t) => {
  const { service, planner, projectId, workspace } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  const storyHash = compiled.creation.storyHash
  await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE })

  const first = await service.syncToProduction({ projectId, storyHash })
  assert.equal(first.reused, false)
  assert.equal(first.creation.status, 'production_ready')
  assert.equal(first.episodeId, deriveEpisodeId(storyHash))
  assert.equal(planner.calls.length, 1)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const repeat = await service.syncToProduction({ projectId, storyHash })
    assert.equal(repeat.reused, true)
    assert.equal(repeat.episodeId, first.episodeId)
  }
  assert.equal(planner.calls.length, 1, '重复同步不应再次调用 Producer Agent')

  const episodesDir = path.join(workspace, 'projects', projectId, 'episodes')
  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(episodesDir), [first.episodeId])
  assert.ok(await stat(path.join(episodesDir, first.episodeId, 'plan.json')))
})

test('并发同步共享一次 Producer Agent 调用', async (t) => {
  const { service, planner, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  const storyHash = compiled.creation.storyHash
  await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE })

  const results = await Promise.all(Array.from({ length: 4 }, () => service.syncToProduction({ projectId, storyHash })))
  assert.equal(planner.calls.length, 1)
  assert.deepEqual([...new Set(results.map(result => result.episodeId))].length, 1)
})

test('同步把导演参数、时长与合规声明带给 Producer Agent', async (t) => {
  const { service, projectId, planner } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  const storyHash = compiled.creation.storyHash
  await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE })
  await service.syncToProduction({ projectId, storyHash })

  assert.equal(planner.calls[0].directorProfile.camera.motionPreference, 'slow dolly, gentle pan, long take')
  assert.equal(planner.calls[0].targetDurationSec, 40)
  assert.deepEqual(planner.calls[0].compliance, COMPLIANCE)
})

test('未确认剧情不能同步', async (t) => {
  const { service, projectId } = await fixture(t)
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  await assert.rejects(
    service.syncToProduction({ projectId, storyHash: compiled.creation.storyHash }),
    /剧情尚未确认/,
  )
})

test('同步失败退回定稿状态并记账，可重试', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-creation-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  let shouldFail = true
  const good = fakePlanner()
  const flaky = {
    async plan(body) {
      if (shouldFail) throw new Error('Qwen3.8 规划失败')
      return good.plan(body)
    },
  }
  const service = createCreationService({ workspace }, flaky)
  const created = await service.createProject({ title: '雾港来信', directorId: 'kokoro-realism' })
  const projectId = created.project.id
  await runAllSteps(service, projectId)
  const compiled = await service.compileStory({ projectId })
  const storyHash = compiled.creation.storyHash
  await service.approveStory({ projectId, storyHash, compliance: COMPLIANCE })

  await assert.rejects(service.syncToProduction({ projectId, storyHash }), /Qwen3.8 规划失败/)
  const failed = await service.getState({ projectId })
  assert.equal(failed.creation.status, 'story_approved')
  assert.equal(failed.creation.sync.lastError, 'Qwen3.8 规划失败')
  assert.equal(failed.creation.sync.attempt, 1)

  shouldFail = false
  const retried = await service.syncToProduction({ projectId, storyHash })
  assert.equal(retried.creation.status, 'production_ready')
  assert.equal(retried.creation.sync.lastError, null)
})

// ── 单集合规校验 ────────────────────────────────────────────────────────────

test('单集合规声明不再只存不校验', () => {
  assert.deepEqual(validateCompliance(undefined), {})
  assert.deepEqual(validateCompliance({}), {})
  assert.deepEqual(validateCompliance(COMPLIANCE), COMPLIANCE)
  assert.throws(() => validateCompliance({ fictional_adults_only: true }), /all_participants_18_or_older 必须明确为 true/)
  assert.throws(() => validateCompliance({ ...COMPLIANCE, consensual_content: false }), /consensual_content 必须明确为 true/)
  assert.throws(() => validateCompliance({}, { required: true }), /必须显式确认全部四项/)
})

test('剧情指纹忽略确认时间与版本号', () => {
  const draft = { schemaVersion: 'elysium-story-1', logline: 'a', confirmedAt: null, storyVersion: 1 }
  const same = { schemaVersion: 'elysium-story-1', logline: 'a', confirmedAt: '2026-09-04T00:00:00.000Z', storyVersion: 9 }
  assert.equal(storyHashOf(draft), storyHashOf(same))
  assert.notEqual(storyHashOf(draft), storyHashOf({ ...draft, logline: 'b' }))
})
