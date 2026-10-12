import test from "node:test";
import assert from "node:assert/strict";
import { expireDownstream } from "../shared/node-dependencies.js";
import { enqueueNode, restoreQueued } from "../shared/node-state.js";
import { nodeOf, createId } from "../shared/task-contract.js";
import { snapshotFixture, taskFixture } from "./fixtures/project.js";
for (const [business, expected] of [
  [
    "episode-plot",
    [
      "episode-summary",
      "outline",
      "shots",
      "seconds",
      "storyboard",
      "video",
      "tail",
      "assembly",
    ],
  ],
  [
    "outline",
    [
      "shots",
      "seconds",
      "storyboard",
      "video",
      "tail",
      "assembly",
    ],
  ],
  ["shots", ["seconds", "storyboard", "video"]],
  ["seconds", ["storyboard", "video", "tail", "assembly"]],
  ["storyboard", ["video", "tail", "assembly"]],
  ["video", ["tail", "assembly"]],
  ["tail", ["video"]],
])
  test(`S3-04/05 ${business} 逐级过期且内容保留`, () => {
    const snapshot = snapshotFixture(),
      p = snapshot.project,
      e = p.剧集[0],
      s = e.镜头表.镜头[0],
      id = ["episode-plot", "outline", "shots"].includes(
        business,
      )
        ? e.id
        : s.id;
    const result = expireDownstream(snapshot, business, id);
    for (const type of expected)
      assert.ok(
        result.some((key) => key.startsWith(`${type}:`)),
        type,
      );
    assert.equal(e.镜头表.镜头[1].视频.状态, "expired");
    assert.equal(s.视频.地址, "1.mp4");
  });
test("S3-03 排队快照随上游失效，取消后恢复 expired", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    t = taskFixture(p, "video"),
    s = p.剧集[0].镜头表.镜头[0];
  enqueueNode(p, t);
  snapshot.tasks = [t];
  expireDownstream(snapshot, "seconds", s.id);
  assert.equal(s.视频.状态, "queued");
  assert.equal(t.previous_node_state.状态, "expired");
  restoreQueued(p, t);
  assert.equal(s.视频.状态, "expired");
});
test("S3-04 剧本更新仅使摘要过期，配置变化不触发过期；非 generated 保持状态", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    s = p.剧集[0].镜头表.镜头[0];
  s.文本提示词.状态 = "rejected";
  s.文本提示词.原因 = "未通过";
  expireDownstream(snapshot, "script", p.id);
  assert.equal(p.项目摘要.状态, "expired");
  assert.equal(p.剧集[0].故事大纲.状态, "generated");
  p.输出语言 = "en";
  p.画幅 = "768x1344";
  p.规则 = [];
  assert.equal(s.视频.状态, "generated");
  expireDownstream(snapshot, "seconds", s.id);
  assert.equal(s.文本提示词.状态, "rejected");
  assert.equal(s.文本提示词.原因, "未通过");
});
test("S3-05 图片变化只使实际使用该参考图的视频过期（基于历史生成结果）", () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project,
    s = p.剧集[0].镜头表.镜头[0];
  const id = createId("character");
  p.角色库.角色 = [
    {
      id,
      编号: "C01",
      图片: { 状态: "generated", 原因: "", 地址: "c.png" },
      服装: [],
    },
  ];
  const t = taskFixture(p, "video", s.id, { task_status: "completed" });
  snapshot.tasks = [t];
  snapshot.steps = [
    { task_id: t.id, result: { address: s.视频.地址, reference_ids: [id] } },
  ];
  expireDownstream(snapshot, "character-image", id);
  assert.equal(s.视频.状态, "expired");
});

test("剧情同步更新只使展示摘要过期，不使故事大纲过期", () => {
  const snapshot = snapshotFixture(),
    e = snapshot.project.剧集[0];
  expireDownstream(snapshot, "episode-plot-sync", e.id, "剧情已更新");
  assert.equal(e.摘要.状态, "expired");
  assert.equal(e.故事大纲.状态, "generated");
});
