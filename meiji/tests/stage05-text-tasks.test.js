import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createTextHandler } from "../server/handlers/text-handler.js";
import { commitContent, aiProjection } from "../server/handlers/content.js";
import {
  loadTemplate,
  renderTemplate,
} from "../server/prompts/yaml-prompts.js";
import {
  projectFixture,
  taskFixture,
  snapshotFixture,
} from "./fixtures/project.js";
import { promptValues } from "../server/handlers/text-handler.js";
const cases = [
  "project-summary",
  "project-characters",
  "script",
  "episode-summary",
  "outline",
  "shots",
  "seconds",
  "storyboard",
];
function output(p, b) {
  const e = p.剧集[0],
    s = e.镜头表.镜头[0];
  return {
    "project-summary": { 正文: "新项目摘要" },
    "project-characters": { 角色: [] },
    script: {
      正文: "新剧本",
      分节: [{ 剧集序号: 1, 正文: "新剧本" }],
      后续剧情: "",
    },
    "episode-summary": { 正文: "新展示摘要" },
    outline: { 小段: e.故事大纲.小段 },
    shots: {
      镜头: e.镜头表.镜头.map((s) => ({
        编号: s.编号,
        参考时长: s.时长秒,
        标题: s.标题,
        正文: s.正文,
      })),
    },
    seconds: {
      衔接上一镜方式: s.每秒分镜.衔接上一镜方式,
      内容: aiProjection(s.每秒分镜.内容, p),
    },
    storyboard: { 正文: s.文本提示词.正文, 环境声: "", 配乐: "" },
  }[b];
}
for (const business of cases)
  for (const ending of ["completed", "rejected", "failed"])
    test(`S5-02/03/04 ${business} 真实文本执行器 ${ending}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-text-"));
      try {
        const p = projectFixture(),
          repository = new ModelRepository(root),
          model = await repository.create(p),
          target = ["project-summary", "project-characters", "script"].includes(
            business,
          )
            ? p.id
            : ["seconds", "storyboard"].includes(business)
              ? p.剧集[0].镜头表.镜头[0].id
              : p.剧集[0].id;
        let generated = 0;
        const handler = createTextHandler({
          chat: async ({ task, step }) => {
            if (step.kind === "review")
              return {
                通过: ending !== "rejected",
                原因: ending === "rejected" ? "未落实剧情" : "",
              };
            if (task.business_type === business) generated++;
            if (ending === "failed") return { 非法: "字段" };
            return output(p, task.business_type);
          },
        });
        const service = new TaskService({
          repository,
          execute: handler,
          commitOutput: commitContent,
        });
        const action =
          business === "project-characters" ? "generate" : "regenerate";
        const result = await service.command({
          type: "submit",
          project_id: p.id,
          request_id: "text",
          business_type: business,
          target_id: target,
          action,
        });
        await service.idle(p.id);
        const snapshot = model.read(),
          task = snapshot.tasks.find((t) => t.id === result.task_id);
        assert.equal(task.task_status, ending, task.end_reason);
        assert.equal(generated, ending === "rejected" ? 3 : 1);
        if (ending === "rejected")
          assert.deepEqual(
            snapshot.steps
              .filter((s) => s.task_id === task.id && s.kind === "review")
              .map((s) => s.round),
            [0, 1, 2],
          );
        if (business === "script" && ending === "completed") {
          assert.equal(snapshot.project.剧本.版本, 2);
          assert.equal(snapshot.project.剧集[0].故事大纲.状态, "generated");
          assert.ok(
            snapshot.tasks.some((t) => t.business_type === "project-summary"),
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
test("S5-01 所有文本模板占位符均从真实项目资料构建，不暴露内部 ID", async () => {
  const snapshot = snapshotFixture(),
    p = snapshot.project;
  for (const business of cases) {
    const target = ["project-summary", "project-characters", "script"].includes(
        business,
      )
        ? p.id
        : ["seconds", "storyboard"].includes(business)
          ? p.剧集[0].镜头表.镜头[0].id
          : p.剧集[0].id,
      t = taskFixture(p, business, target);
    for (const suffix of ["generate", "regenerate", "review"]) {
      const template = await loadTemplate(`${business}-${suffix}`),
        prompt = renderTemplate(
          template,
          promptValues(
            snapshot,
            t,
            null,
            suffix === "review" ? "review" : "generate",
          ),
        );
      assert.ok(!prompt.system.includes(p.id));
      assert.ok(!prompt.user.includes(p.id));
    }
  }
});
