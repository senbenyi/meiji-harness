import { parseJsonValue } from "../gateway/model-gateway.js";
import {
  loadTemplate,
  renderTemplate,
  ruleInputs,
  languageName,
} from "../prompts/yaml-prompts.js";
import {
  nodeOf,
  locateTarget,
  projectNumberCatalog,
} from "../../shared/task-contract.js";
import { aiProjection, validateShape, prepareContent } from "./content.js";
import { shotDurationRange } from "../../shared/node-state.js";
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

function shotTableForPrompt(value) {
  return {
    镜头: (value?.镜头 || []).map((shot) => ({
      标题: shot.标题,
      编号: shot.编号,
      参考时长: shot.参考时长 ?? shot.时长秒,
      正文: shot.正文,
    })),
  };
}

export function promptValues(snapshot, task, draft, kind, step = null) {
  const p = snapshot.project,
    { object, episode } = locateTarget(p, task.business_type, task.target_id),
    catalog = projectNumberCatalog(p, episode?.id),
    shots = episode
      ? [...episode.镜头表.镜头].sort((a, b) => a.序号 - b.序号)
      : [],
    shotRange = episode ? shotDurationRange(episode.时长秒) : null,
    draftShotTable = shotTableForPrompt(draft),
    draftShotTotal = draftShotTable.镜头.reduce(
      (total, shot) => total + (shot.参考时长 || 0),
      0,
    ),
    prev = shots[shots.findIndex((s) => s.id === object.id) - 1];
  const lastReview = snapshot.steps
    .filter(
      (s) =>
        s.task_id === task.id &&
        s.kind === "review" &&
        s.step_status === "done",
    )
    .sort((a, b) => b.seq - a.seq)[0]?.result;
  const validationError = snapshot.steps
    .filter((s) => s.task_id === task.id && s.seq < (step?.seq ?? Infinity) && s.step_status === "failed")
    .sort((a, b) => b.seq - a.seq)[0]?.error_reason || "";
  return {
    输出语言: languageName(p.输出语言),
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
    镜头表允许总时长秒: shotRange || "",
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
    本镜镜头表: aiProjection(object, p),
    本集角色资料: catalog.角色,
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
    修改意见: [
      kind === "revise" ? lastReview?.原因 : "",
      validationError
        ? `程序校验错误：${validationError}。当前${draftShotTable.镜头.length}镜合计${draftShotTotal}秒；本集目标${episode?.时长秒}秒，允许${shotRange?.min}–${shotRange?.max}秒。按故事大纲小段调整拆分和参考时长，每镜为1至15秒；不新增、重复或省略剧情。`
        : "",
      task.opinion,
    ].filter(Boolean).join("\n"),
    待修订镜头表:
      task.business_type === "shots"
        ? shotTableForPrompt(
            kind === "revise"
              ? draft || {}
              : task.action === "regenerate"
                ? object || {}
                : {},
          )
        : "",
    基稿: aiProjection(
      draft || nodeOf(p, task.business_type, task.target_id) || p.剧本,
      p,
    ),
    待审核内容:
      task.business_type === "shots"
        ? shotTableForPrompt(draft || {})
        : aiProjection(draft || {}, p),
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
      values = promptValues(snapshot, task, draft, step.kind, step);
    // 资料占位名来自当前唯一 YAML，不能缺失时静默填默认空串。
    const prompt = renderTemplate(template, values);
    await record({ prompt });
    const response = await chat({
      system: prompt.system,
      prompt: prompt.user,
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
    let content;
    try {
      content = prepareContent(snapshot, task, raw);
    } catch (error) {
      if (
        task.business_type === "shots" &&
        (error.message === "镜头.时长秒：最多 15 秒" ||
          error.message.startsWith("镜头表：镜头总时长超出允许范围"))
      )
        return {
          content: raw,
          prepared_content: error.preparedContent,
          result: raw,
          prompt,
          validation_error: error.message,
        };
      throw error;
    }
    return { content, result: raw, prompt };
  };
}
