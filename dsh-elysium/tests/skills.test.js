// 职责：验证标准 Skill 全文存储、引用读取与默认种子不覆盖运营修改。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createSkillsStore } from '../src/database/managers/skills.js'

test('Skill store validates frontmatter, reads references and seeds only once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-skills-'))
  const source = join(root, 'seed')
  try {
    await mkdir(join(source, 'references'), { recursive: true })
    const first = '---\nname: drama-planning\ndescription: 短剧规划\nmetadata:\n  kind: planning\n  llm:\n    max_tokens: 8192\n---\n\n# 规划\n'
    await writeFile(join(source, 'SKILL.md'), first)
    await writeFile(join(source, 'references', 'checklist.md'), '检查人物与场景')
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const skills = createSkillsStore()
      assert.equal(await skills.seed('drama-planning', source), true)
      assert.equal((await skills.get('drama-planning')).metadata.llm.max_tokens, 8192)
      assert.equal(await skills.reference('drama-planning', 'checklist.md'), '检查人物与场景')
      assert.deepEqual((await skills.list('planning')).map(item => item.name), ['drama-planning'])
      const edited = first.replace('# 规划', '# 运营修改')
      await skills.save('drama-planning', edited)
      assert.equal(await skills.seed('drama-planning', source), false)
      assert.equal(await readFile(join(root, 'pools', 'skills', 'drama-planning', 'SKILL.md'), 'utf8'), edited)
      await assert.rejects(skills.save('drama-planning', first.replace('name: drama-planning', 'name: other')), /目录名不一致/)
      await assert.rejects(skills.save('drama-planning', first.replace('description: 短剧规划', 'description:')), /非空 description/)
      await assert.rejects(skills.reference('drama-planning', '../bad.md'), /引用路径无效/)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
