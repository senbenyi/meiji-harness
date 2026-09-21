// 职责：验证导演 Skill 的全文保存、排序和项目引用保护。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createDirectorStore } from '../src/server/directors/service.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createDirectorHandler, DIRECTOR_ROUTE } from '../src/server/routes/directors.js'

const cover = 'f'.repeat(32)
const coverOptions = { readJob: async job_id => ({ job_id, status: 'succeeded' }), summarizeJob: async () => ({ has_image: true }) }

test('director routes save full Skill text, reorder metadata and protect project references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-directors-'))
  let handler, directors, projects
  withConfig({ ELYSIUM_STATE_ROOT: root }, () => {
    directors = createDirectorStore()
    projects = createProjectStore({ ...coverOptions, newId: () => '1234abcd', directorExists: name => directors.has(name) })
    handler = createDirectorHandler({ token: 't', directorStore: directors, projectStore: projects })
  })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}${DIRECTOR_ROUTE}`
  const request = (action, body) => fetch(`${origin}/${action}?t=t`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(`${origin}/list`)).status, 401)
    assert.deepEqual(await (await request('list')).json(), [])
    let response = await request('create', { display_name: '毕赣' })
    assert.equal(response.status, 201)
    const first = await response.json()
    assert.match(first.name, /^director-[a-f0-9]{8}$/)
    assert.match(first.content, /metadata:\n  kind: director/)
    assert.deepEqual(Object.keys(first.files), ['SKILL.md', 'series.md', 'script.md', 'storyboard.md'])
    assert.doesNotMatch(first.content, /## 叙事节奏|## 镜头语言/)
    assert.match(first.files['script.md'], /叙事节奏/)
    assert.match(first.files['storyboard.md'], /镜头语言/)
    assert.match(first.files['series.md'], /固定 2 集/)
    response = await request('create', { display_name: '姜文' })
    assert.equal(response.status, 201)
    const second = await response.json()
    const changed = first.content.replace('display_name: "毕赣"', 'display_name: "新毕赣"')
    response = await request('save', { name: first.name, file: 'SKILL.md', content: changed })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).display_name, '新毕赣')
    assert.equal(await readFile(join(root, 'pools', 'skills', first.name, 'SKILL.md'), 'utf8'), changed)
    for (const file of ['series.md', 'script.md', 'storyboard.md']) {
      response = await request('save', { name: first.name, file, content: `# ${file}\n导演内容` })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).files[file], `# ${file}\n导演内容`)
      assert.equal(await readFile(join(root, 'pools', 'skills', first.name, 'references', file), 'utf8'), `# ${file}\n导演内容`)
    }
    assert.equal((await request('save', { name: first.name, file: 'steps/script.md', content: '非法' })).status, 400)
    assert.equal((await request('save', { name: first.name, file: '../SKILL.md', content: '非法' })).status, 400)
    assert.equal((await request('save', { name: first.name, file: 'SKILL.md', content: changed.replace(`name: ${first.name}`, 'name: other') })).status, 400)
    assert.equal((await request('save', { name: first.name, file: 'SKILL.md', content: changed.replace('description:', 'missing:') })).status, 400)
    response = await fetch(`${origin}/get?t=t&name=${first.name}`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).content, changed)
    response = await request('reorder', { names: [second.name, first.name] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).map(item => item.name), [second.name, first.name])
    assert.match(await readFile(join(root, 'pools', 'skills', first.name, 'SKILL.md'), 'utf8'), /  order: 1/)
    assert.equal((await request('reorder', { names: [first.name] })).status, 400)
    const project = await withConfig({ ELYSIUM_STATE_ROOT: root }, () => projects.change('create', { title: '项目', director: first.name, cover_job_id: cover }))
    assert.equal((await withConfig({ ELYSIUM_STATE_ROOT: root }, () => projects.read(project.id))).director, first.name)
    response = await request('remove', { name: first.name })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, '该导演已被项目使用，不能删除')
    assert.equal((await request('remove', { name: second.name })).status, 200)
    assert.deepEqual((await request('list').then(value => value.json())).map(item => item.name), [first.name])
    const suppliedContent = '---\nname: director-new\ndescription: "自定义风格"\nmetadata:\n  kind: director\n  display_name: "模板名称"\n  order: 0\n---\n\n# 自定义风格\n\n独特段落\n'
    response = await request('create', { display_name: '新导演', content: suppliedContent })
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.match(created.content, new RegExp(`name: ${created.name}`))
    assert.match(created.content, /display_name: "新导演"/)
    assert.match(created.content, /  order: 1/)
    assert.match(created.content, /description: "自定义风格"/)
    assert.match(created.content, /独特段落/)
    assert.equal(await readFile(join(root, 'pools', 'skills', created.name, 'SKILL.md'), 'utf8'), created.content)
    assert.equal((await request('create', { display_name: '无效导演', content: suppliedContent.replace('kind: director', 'kind: other') })).status, 400)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
