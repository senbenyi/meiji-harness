import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate, renderTemplate } from '../server/prompts/yaml-prompts.js';
import { promptValues } from '../server/handlers/text-handler.js';
import { prepareContent } from '../server/handlers/content.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';

for (const suffix of ['generate', 'regenerate']) test(`镜头表${suffix}按故事小段细分且只要求四字段`, async () => {
  const s = snapshotFixture(), p = s.project, e = p.剧集[0];
  p.角色库.角色 = [{ id: 'c_library', 编号: 'C07', 名称: '周巡检', 身份: '军中巡检',
    国籍: '', 身份特征: '', 性别: '', 年代: '', 年龄: '', 身高: '', 体型: '', 面相: '',
    声音: '', 必出: true, 默认服装id: '', 图片: { 地址: '' }, 参考图: { 地址: '' }, 服装: [] }];
  e.时长秒 = 300;
  e.故事大纲.小段[0].时长秒 = 300;
  const t = taskFixture(p, 'shots', e.id, { opinion: '' });
  const rendered = renderTemplate(await loadTemplate(`shots-${suffix}`), promptValues(s, t, {}, 'generate'));

  assert.match(rendered.system, /把【本集故事小段】中的每个小段按原顺序拆成更细的镜头/);
  assert.match(rendered.system, /每个镜头参考时长为1至15秒正整数/);
  assert.match(rendered.system, /切点参考，不要求每种情况都拆/);
  assert.match(rendered.user, /周巡检/);
  assert.doesNotMatch(rendered.system + rendered.user, /本集资产/);
  assert.doesNotMatch(rendered.system + rendered.user, /最低镜头数|小段预算|逐镜累加|本集参考时长秒/);
  assert.deepEqual(Object.keys(rendered.output.structure.镜头[0]), ['标题', '编号', '参考时长', '正文']);
  if (suffix === 'regenerate') assert.match(rendered.user, /待修订镜头表/);
});

test('四字段镜头表在写入前映射到项目镜头字段', () => {
  const snapshot = snapshotFixture(), project = snapshot.project, episode = project.剧集[0];
  episode.时长秒 = 10;
  episode.故事大纲.小段[0].时长秒 = 10;
  const task = taskFixture(project, 'shots', episode.id, { action: 'regenerate' });
  const content = prepareContent(snapshot, task, {
    镜头: [{ 标题: '开门', 编号: 'S01', 参考时长: 10, 正文: '人物推门进入。' }],
  });

  assert.deepEqual(
    content.镜头.map(({ 序号, 编号, 时长秒, 标题, 正文, 出镜角色 }) =>
      [序号, 编号, 时长秒, 标题, 正文, 出镜角色]),
    [[1, 'S01', 10, '开门', '人物推门进入。', []]],
  );
});
