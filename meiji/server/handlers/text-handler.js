import { parseJsonValue } from "../gateway/model-gateway.js";
import {
  loadTemplate,
  renderTemplate,
  ruleInputs,
} from "../prompts/yaml-prompts.js";
import {
  nodeOf,
  locateTarget,
  projectNumberCatalog,
} from "../../shared/task-contract.js";
import { aiProjection, validateShape, prepareContent } from "./content.js";
import {
  numberedScript,
  scriptParagraphs,
  paragraphNumber,
} from "./script-split.js";

// 上一版切分以段落编号表示，便于按意见只调整相关切点。
function previousSplit(p) {
  let start = 0;
  return [...p.剧集]
    .sort((a, b) => a.序号 - b.序号)
    .map((e) => {
      const count = scriptParagraphs(e.剧情).length,
        row = {
          序号: e.序号,
          起始段落: paragraphNumber(start),
          结束段落: paragraphNumber(Math.max(start, start + count - 1)),
          预估时长秒: e.时长秒,
        };
      start += count;
      return row;
    });
}

export function promptValues(snapshot, task, draft, kind) {
  const p = snapshot.project,
    { object, episode } = locateTarget(p, task.business_type, task.target_id),
    catalog = projectNumberCatalog(p, episode?.id),
    shots = episode
      ? [...episode.镜头表.镜头].sort((a, b) => a.序号 - b.序号)
      : [],
    prev = shots[shots.findIndex((s) => s.id === object.id) - 1];
  const lastReview = snapshot.steps
    .filter(
      (s) =>
        s.task_id === task.id &&
        s.kind === "review" &&
        s.step_status === "done",
    )
    .sort((a, b) => b.seq - a.seq)[0]?.result;
  return {
    输出语言: p.输出语言,
    ...ruleInputs(p.规则, task.business_type, task.target_id),
    完整剧本: p.剧本.正文,
    当前剧本: {
      ...aiProjection(p.剧本, p),
      分节: p.剧集.map((e) => ({ 剧集序号: e.序号, 正文: e.剧情 })),
    },
    本次剧本修改依据: p.剧集.map((e) => ({
      剧集序号: e.序号,
      故事大纲: e.故事大纲.小段,
    })),
    创作方向: p.创作方向,
    本集要求: episode?.本集要求 || "",
    本集时长秒: episode?.时长秒 || 0,
    项目摘要: p.项目摘要.正文,
    剧情依据:
      p.创作方式 === "剧本"
        ? episode?.剧情 || ""
        : {
            创作方向: p.创作方向,
            已发生剧情: p.剧集
              .filter((e) => e.序号 < (episode?.序号 || 0))
              .map((e) => e.故事大纲.小段),
          },
    剧情依据优先级:
      p.创作方式 === "剧本"
        ? "以本集剧情（拆分后的剧本原文）为最高事实依据，不改事件与原台词。"
        : "以创作方向及已发生剧情为依据，保留既有事实。",
    本集分场边界: episode?.本集要求 || "",
    创作方式: p.创作方式,
    本集剧情: episode?.剧情 || "",
    本集故事小段: episode?.故事大纲.小段 || [],
    编号剧本: numberedScript(p.剧本.正文),
    参考单集时长秒: p.参考单集时长秒,
    上一版切分: previousSplit(p),
    项目角色库目录: catalog.角色,
    本集资产: aiProjection(episode?.本集资产 || {}, p),
    本镜镜头表: aiProjection(object, p),
    本集角色资料: catalog.角色.filter((c) =>
      episode?.本集资产.角色.some(
        (r) => p.角色库.角色.find((ch) => ch.id === r.角色id)?.编号 === c.编号,
      ),
    ),
    本镜角色资料: catalog.角色.filter((c) =>
      object.出镜角色?.some(
        (r) => p.角色库.角色.find((ch) => ch.id === r.角色id)?.编号 === c.编号,
      ),
    ),
    本镜每秒分镜: aiProjection(object.每秒分镜 || {}, p),
    固定素材清单: catalog.角色.map((c) => ({
      编号: c.编号,
      有图: c.有图,
      服装: c.服装,
    })),
    上一镜交接: prev ? aiProjection(prev.每秒分镜, p) : "",
    已有镜头编号目录: shots.map((s) => ({ 编号: s.编号, 序号: s.序号 })),
    编号规则:
      "已有对象沿用原编号；新角色 C 加连续数字，新服装为角色编号加连字符及数字，新镜头 S 加连续数字，不复用已占用编号。",
    必出判定规则: "仅将完整剧本明确承担必要主线剧情的角色标为必出。",
    修改意见:
      kind === "revise" ? lastReview?.原因 || task.opinion : task.opinion,
    基稿: aiProjection(
      draft || nodeOf(p, task.business_type, task.target_id) || p.剧本,
      p,
    ),
    待审核内容: aiProjection(draft || {}, p),
    当前内容: aiProjection(draft || {}, p),
  };
}
export function createTextHandler({ chat }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    const suffix =
      step.kind === "review"
        ? "review"
        : step.kind === "revise" || task.action === "regenerate"
          ? "regenerate"
          : "generate";
    const template = await loadTemplate(`${task.business_type}-${suffix}`),
      values = promptValues(snapshot, task, draft, step.kind);
    // 资料占位名来自当前唯一 YAML，不能缺失时静默填默认空串。
    const prompt = renderTemplate(template, values);
    await record({ prompt });
    const response = await chat({
      system: prompt.system,
      prompt: prompt.user,
      json: true,
      signal,
      task,
      step,
      trace: prompt,
      record,
    });
    const raw =
      typeof response === "string" ? parseJsonValue(response) : response;
    validateShape(raw, prompt.output.structure);
    if (step.kind === "review") return { result: raw, prompt };
    const content = prepareContent(snapshot, task, raw);
    return { content, result: raw, prompt };
  };
}
