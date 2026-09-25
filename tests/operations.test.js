import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentSessionId, projectRefreshMark, sessionIdFromNode, sessionIdFromStorage } from '../client/chat-bridge.js'
import { episodeWork } from '../client/overview.js'
import { buildImageGraph } from '../server/generate/image.js'
import { describeOperation, runOperation, stageOperation, takeOperation, takePendingForSession } from '../server/flow/actions.js'
import { projectStore } from '../server/data/projects.js'

const look = '二十出头的中国青年男子，短黑发，皮肤晒黑，穿着旧外套，手里拎着鼓囊的编织袋'

test('the selected session row exposes its session id', () => {
  const node = { __reactFiber$x: { key: null, return: { key: 'session-438a7a11-3984-447d-88df-16d610f8e914', return: null } } }
  assert.equal(sessionIdFromNode(node), 'session-438a7a11-3984-447d-88df-16d610f8e914')
  assert.equal(sessionIdFromNode({}), '')
})

test('an episode view keeps the pencil board and a new board url refreshes the panel', () => {
  const project = {
    id: 'p',
    updatedAt: 't',
    episodes: [{ id: 'e1', boards: { S01: { url: '/boards/S01?v=1' } }, films: { S01: { status: 'running' } }, storyboard: [] }],
  }
  const work = episodeWork(project, 'e1')
  assert.equal(work.boards.S01.url, '/boards/S01?v=1')
  const before = projectRefreshMark(project)
  project.episodes[0].boards.S01.url = '/boards/S01?v=2'
  assert.notEqual(projectRefreshMark(project), before)
  const filming = projectRefreshMark(project)
  project.episodes[0].films.S01 = { status: 'ready', url: '/films/e1/S01?v=3' }
  assert.notEqual(projectRefreshMark(project), filming)
})

test('the current session is read from storage when the sidebar row is gone', () => {
  const sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const storage = { getItem: () => JSON.stringify({ sessionId }) }
  assert.equal(sessionIdFromStorage(storage), sessionId)
  assert.equal(sessionIdFromStorage({ getItem: () => '{"sessionId":"nope"}' }), '')
  const doc = {
    querySelector: () => null,
    defaultView: { localStorage: storage },
  }
  assert.equal(currentSessionId(doc), sessionId)
})

test('a panel instruction carries its operation id without unrelated identifiers', () => {
  const text = describeOperation({ id: 'op-1', action: 'image', itemId: 'A01', itemName: '傻根', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成图片/)
  assert.match(text, /operationId: op-1/)
  assert.match(text, /傻根/)
  assert.equal(/项目：|p1|A01/.test(text), false)
  assert.match(text, /必须传入上面的 operationId/)
})

test('a panel click requires its explicit id and owning session', () => {
  const sessionId = 'session-438a7a11-3984-447d-88df-16d610f8e914'
  const id = stageOperation({ action: 'storyboard', sessionId, projectId: 'p1' })
  assert.throws(() => takePendingForSession(sessionId), /operationId/)
  assert.throws(() => takeOperation(id, 'another-session'), /不属于当前会话/)
  const operation = takeOperation(id, sessionId)
  assert.equal(operation.id, id)
  assert.equal(operation.action, 'storyboard')
  assert.equal(takePendingForSession(sessionId), null)
})

test('image operation returns the prompt while the still is still running', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-op-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, { characters: { items: [{ id: 'A01', name: '傻根', type: 'role', look }] } })
    let submitted = ''
    const trace = await runOperation({ action: 'image', projectId: created.id, itemId: 'A01' }, {
      home,
      llm: {},
      submitAssetImage: async (input) => { submitted = input.prompt; return new Promise(() => {}) },
    })
    assert.equal(submitted.includes('旧外套'), false)
    assert.match(submitted, /上半身裸露/)
    assert.match(submitted, /如果是女性，只穿比基尼/)
    assert.match(submitted, /正面全身照/)
    assert.match(submitted, /灰白纯色背景/)
    assert.match(submitted, /[\u4e00-\u9fff]/)
    assert.match(trace.join('\n'), /沿用这张卡已有的中文画面提示词/)
    assert.equal(/译成英文/.test(trace.join('\n')), false)
    assert.match(trace.join('\n'), /正在生成 A01 傻根/)
    assert.equal(trace.status, 'running')
    assert.equal((await projects.read(created.id)).activity, 'image:A01')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a shot table review regenerates the whole table', () => {
  const text = describeOperation({ id: 'op-13', action: 'shots', review: '打架不要切这么碎', projectId: 'p1' })
  assert.match(text, /【极乐世界】写镜头表/)
  assert.match(text, /审核意见：打架不要切这么碎/)
  assert.match(text, /按这条意见重写整张镜头表/)
  assert.match(text, /函数：generateShots/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a shot revision names the shot and its review', () => {
  const text = describeOperation({ id: 'op-8', action: 'revise-shot', track: 'S03', review: '手要松开', projectId: 'p1' })
  assert.match(text, /【极乐世界】按审核意见重写镜头/)
  assert.match(text, /镜头 S03/)
  assert.match(text, /审核意见：手要松开/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a per-second click names the shot and its skill', () => {
  const text = describeOperation({ id: 'op-7', action: 'shot-seconds', track: 'S04', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成每秒指令/)
  assert.match(text, /镜头 S04/)
  assert.match(text, /skill-jingtou-meimiao-seconds-generate\.md/)
  assert.match(text, /函数：generateShotSeconds/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('a per-shot storyboard names the shot and its skill', () => {
  const text = describeOperation({ id: 'op-10', action: 'shot-storyboard', track: 'S03', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成这一镜的分镜/)
  assert.match(text, /镜头 S03/)
  assert.match(text, /skill-jingtou-wenben-storyboard-generate\.md/)
  assert.match(text, /函数：generateShotStoryboard/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('the full storyboard also writes any missing seconds', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-storyboard-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      shots: { items: [{ id: 'S01', duration: 2, seconds: [{ range: '0-1', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }, { range: '1-2', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }] }, { id: 'S02', duration: 2 }], check: { passed: true, failures: [] } },
    })
    const order = []
    await runOperation({ action: 'storyboard', projectId: created.id }, {
      home,
      llm: {},
      generateShotSeconds: async ({ shotId }) => {
        order.push(shotId)
        const current = await projects.read(created.id)
        return { items: current.shots.items.map(item => item.id === shotId ? { ...item, seconds: [{ range: '0-1', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }, { range: '1-2', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }] } : item) }
      },
      generateStoryboard: async ({ project }) => {
        order.push('board')
        assert.equal(project.shots.items[1].seconds.length, 2)
        return project.shots.items.map(item => ({ id: item.id, title: item.id }))
      },
    })
    assert.deepEqual(order, ['S02', 'board'])
    const saved = await projects.read(created.id)
    assert.equal(saved.shots.items[1].seconds.length, 2)
    assert.equal(saved.storyboard.length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('generating all boards names both shot functions', () => {
  const text = describeOperation({ id: 'op-12', action: 'shot-boards', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成所有分镜/)
  assert.match(text, /逐镜调用每秒指令和文本分镜/)
  assert.match(text, /函数：generateShotSeconds/)
  assert.match(text, /函数：generateShotStoryboard/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('all boards are written shot by shot without clearing the earlier board', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-boards-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      shots: { items: [{ id: 'S01', duration: 2 }, { id: 'S02', duration: 2 }], check: { passed: true, failures: [] } },
      storyboard: [{ id: 'S01', title: '旧' }, { id: 'S02', title: '旧二' }],
      films: { S01: { status: 'ready' }, S02: { status: 'ready' } },
      boards: { S01: { url: '/old' }, S02: { url: '/old2' } },
    })
    const order = []
    await runOperation({ action: 'shot-boards', projectId: created.id }, {
      home,
      llm: {},
      generateShotSeconds: async ({ shotId, project }) => {
        order.push(`seconds:${shotId}`)
        return { items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: [{ range: '0-1', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }, { range: '1-2', action: '站立', camera: '远景', space: '门前', audio: 'silent', handoff: '站立' }] } : item) }
      },
      generateShotStoryboard: async ({ shotId, project }) => {
        order.push(`board:${shotId}`)
        if (shotId === 'S02') assert.equal(project.storyboard.find(item => item.id === 'S01').title, '新一')
        const byId = new Map((project.storyboard || []).map(item => [item.id, item]))
        byId.set(shotId, { id: shotId, title: shotId === 'S01' ? '新一' : '新二' })
        return project.shots.items.map(item => byId.get(item.id)).filter(Boolean)
      },
    })
    assert.deepEqual(order, ['seconds:S01', 'board:S01', 'seconds:S02', 'board:S02'])
    const saved = await projects.read(created.id)
    assert.equal(saved.shots.items[1].seconds.length, 2)
    assert.equal(saved.storyboard[0].title, '新一')
    assert.equal(saved.storyboard[1].title, '新二')
    assert.equal(saved.films.S01, undefined)
    assert.equal(saved.films.S02, undefined)
    assert.equal(saved.boards?.S01, undefined)
    assert.equal(saved.activity, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a pencil click names the shot and its sheet', () => {
  const text = describeOperation({ id: 'op-11', action: 'pencil', track: 'S01', projectId: 'p1' })
  assert.match(text, /【极乐世界】生成铅笔分镜/)
  assert.match(text, /镜头 S01/)
  assert.match(text, /每秒一格/)
  assert.match(text, /调用 meiji_panel 执行，必须传入上面的 operationId/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('one shot pencil board waits for confirmation before becoming active', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-pencil-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      storyboard: [{
        id: 'S01', duration: 2, title: '睁眼', scene: '天台',
        panels: [
          { time: '0–1s', pose: '背对镜头', camera: '锁定', space: '左' },
          { time: '1–2s', pose: '跃下', camera: '仰角', space: '中' },
        ],
      }],
    })
    const seen = {}
    const trace = await runOperation({ action: 'pencil', projectId: created.id, track: 'S01' }, {
      home,
      llm: {},
      submitPencilBoard: async ({ prompt, aspectRatio, track }) => {
        seen.prompt = prompt
        seen.aspectRatio = aspectRatio
        seen.track = track
        return { draftId: 'test-draft', previewUrl: '/preview' }
      },
    })
    assert.equal(seen.track, 'S01')
    assert.equal(seen.aspectRatio, '1344x768')
    assert.match(seen.prompt, /一共 2 格/)
    assert.match(trace.join('\n'), /S01 的铅笔分镜已生成，等待确认使用/)
    const saved = await projects.read(created.id)
    assert.equal(saved.boards?.S01, undefined)
    assert.equal(saved.pendingImages['test-draft'].track, 'S01')
    assert.equal(saved.activity, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a film click names the tool, the skill, and the prompt', () => {
  const text = describeOperation({ id: 'op-9', action: 'film', track: '2', projectId: 'p1', prompt: '张飞睁眼' })
  assert.match(text, /【极乐世界】提交成片/)
  assert.match(text, /轨道 2/)
  assert.match(text, /文件：server\/generate\/film.js/)
  assert.match(text, /函数：submitH3/)
  assert.match(text, /工具：meiji_panel/)
  assert.match(text, /最终提交参数：/)
  assert.match(text, /model: elysium-video/)
  assert.match(text, /quality: medium/)
  assert.match(text, /prompt:\n张飞睁眼/)
  assert.equal(/项目：|p1/.test(text), false)
})

test('concat joins ready shots in storyboard order', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-concat-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      shots: { items: [{ id: 'S01' }, { id: 'S02' }] },
      storyboard: [
        { id: 'S01', duration: 6, title: '睁眼' },
        { id: 'S02', duration: 4, title: '回头' },
      ],
      films: { S01: { status: 'ready' }, S02: { status: 'ready' } },
    })
    let seen = []
    const trace = await runOperation({ action: 'assemble', projectId: created.id }, {
      home,
      llm: {},
      concatFilms: async ({ inputs, output }) => {
        seen = inputs.map(input => input.split('/').pop())
        await writeFile(output, 'joined')
      },
    })
    assert.deepEqual(seen, ['S01.mp4', 'S02.mp4'])
    assert.match(trace.join('\n'), /函数：concatFilms/)
    const saved = await projects.read(created.id)
    assert.equal(saved.assembly.status, 'ready')
    assert.match(saved.assembly.url, /\/films\/assembly\?v=/)
    assert.equal(saved.activity, null)
    assert.equal(await readFile(join(home, 'storages', 'meiji', 'projects', created.id, 'films', 'assembly.mp4'), 'utf8'), 'joined')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('one click films each shot in order and waits for the clip', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-films-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      shots: { items: [{ id: 'S01' }, { id: 'S02' }] },
      storyboard: [
        { id: 'S01', duration: 6, title: '睁眼', prompt: { integrated: '张飞睁眼', soundscape: 'wind', music: 'N/A' } },
        { id: 'S02', duration: 4, title: '回头', prompt: { integrated: '张飞回头', soundscape: 'wind', music: 'N/A' } },
      ],
    })
    const order = []
    const trace = await runOperation({ action: 'films', projectId: created.id }, {
      home,
      llm: {},
      saveLastFrame: async (_video, frame) => {
        order.push(`frame:${frame.split('/').pop()}`)
        await writeFile(frame, Buffer.from('png'))
        return Buffer.from('png')
      },
      submitH3: async ({ items }) => {
        order.push(`submit:${items[0].track}`)
        const saved = await projects.read(created.id)
        if (items[0].track === 'S01') assert.equal(items[0].inputReference, undefined)
        if (items[0].track === 'S02') {
          assert.equal(saved.films.S01.status, 'ready')
          assert.equal(items[0].inputReference, Buffer.from('png').toString('base64'))
        }
        return { baseUrl: 'http://gateway.test/v1', shots: [{ track: items[0].track, promptId: items[0].track, duration: items[0].duration }] }
      },
      retrieveFilm: async ({ promptId }) => {
        order.push(`file:${promptId}`)
        return Buffer.from(promptId)
      },
    })
    assert.deepEqual(order, ['submit:S01', 'file:S01', 'frame:S01-last.png', 'submit:S02', 'file:S02', 'frame:S02-last.png'])
    assert.match(trace.join('\n'), /文生视频：不上传首帧和参考图/)
    assert.match(trace.join('\n'), /首帧：上一镜 S01 的尾帧/)
    assert.match(trace.join('\n'), /函数：submitH3/)
    const saved = await projects.read(created.id)
    assert.equal(saved.films.S01.status, 'ready')
    assert.equal(saved.films.S01.lastFrame, 'S01-last.png')
    assert.equal(saved.films.S02.status, 'ready')
    assert.equal(saved.films.S02.lastFrame, 'S02-last.png')
    assert.equal(saved.activity, null)
    assert.equal(await readFile(join(home, 'storages', 'meiji', 'projects', created.id, 'films', 'S02.mp4'), 'utf8'), 'S02')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a later shot needs the previous clip before it can take the last frame', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-film-ref-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      shots: { items: [{ id: 'S01' }, { id: 'S02' }] },
      storyboard: [
        { id: 'S01', duration: 6, title: '睁眼', prompt: { integrated: '张飞睁眼', soundscape: 'wind', music: 'N/A' } },
        { id: 'S02', duration: 4, title: '回头', prompt: { integrated: '张飞回头', soundscape: 'wind', music: 'N/A' } },
      ],
    })
    await assert.rejects(
      runOperation({ action: 'film', projectId: created.id, track: 'S02' }, { home, llm: {}, saveLastFrame: async () => Buffer.from('png') }),
      /请先完成上一镜 S01/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('one track film keeps the prompt and later shows the clip', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-film-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      storyboard: [{ id: 'S01', duration: 6, title: '睁眼', prompt: { integrated: '张飞睁眼', soundscape: 'wind', music: 'N/A' } }],
      reviews: { brief: 'approved', outline: 'approved', characters: 'approved', scenes: 'approved', shots: 'approved', storyboard: 'approved', film: 'pending' },
    })
    const trace = await runOperation({ action: 'film', projectId: created.id, track: 'S01' }, {
      home,
      llm: {},
      submitH3: async () => ({ baseUrl: 'http://comfy.test/comfy', shots: [{ track: 'S01', promptId: 'job-1', duration: 6 }] }),
      retrieveFilm: async () => Buffer.from('fake-mp4'),
      saveLastFrame: async (_video, frame) => { await writeFile(frame, Buffer.from('png')); return Buffer.from('png') },
    })
    const text = trace.join('\n')
    assert.match(text, /已执行：提交成片/)
    assert.match(text, /文件：server\/generate\/film.js/)
    assert.match(text, /函数：submitH3/)
    assert.match(text, /integrated_multimodal_description: 张飞睁眼/)
    let saved
    for (let i = 0; i < 20; i++) {
      saved = await projects.read(created.id)
      if (saved.films?.S01?.status === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(saved.films.S01.status, 'ready')
    assert.match(saved.films.S01.url, /\/films\/S01\?v=/)
    assert.equal(saved.activity, null)
    assert.equal(await readFile(join(home, 'storages', 'meiji', 'projects', created.id, 'films', 'S01.mp4'), 'utf8'), 'fake-mp4')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('one shot can be filmed once its storyboard exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-film-shot-'))
  const projects = projectStore(home)
  try {
    const created = await projects.create({ title: '测', durationSeconds: 60, summary: '一个进城的故事，人物已经写在摘要里。' })
    await projects.save(created.id, {
      storyboard: [{ id: 'S01', duration: 6, title: '睁眼', prompt: { integrated: '张飞睁眼', soundscape: 'wind', music: 'N/A' } }],
      reviews: { storyboard: 'pending' },
    })
    const trace = await runOperation({ action: 'film', projectId: created.id, track: 'S01' }, {
      home,
      llm: {},
      submitH3: async () => ({ baseUrl: 'http://comfy.test/comfy', shots: [{ track: 'S01', promptId: 'job-2', duration: 6 }] }),
      retrieveFilm: async () => Buffer.from('fake-mp4'),
      saveLastFrame: async (_video, frame) => { await writeFile(frame, Buffer.from('png')); return Buffer.from('png') },
    })
    assert.match(trace.join('\n'), /已执行：提交成片/)
    let saved
    for (let i = 0; i < 20; i++) {
      saved = await projects.read(created.id)
      if (saved.films?.S01?.status === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(saved.films.S01.status, 'ready')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a revised still encodes the current image instead of an empty latent', () => {
  const graph = buildImageGraph({ prompt: look, seed: 3, width: 768, height: 1344, prefix: 'a', imageName: 'ref.png' })
  assert.equal(graph[5].inputs.denoise, 0.55)
  assert.deepEqual(graph[5].inputs.latent_image, ['9', 0])
  assert.equal(graph[8].inputs.image, 'ref.png')
})
