import { parseJsonValue } from "../gateway/model-gateway.js";
import { loadTemplate, renderTemplate, ruleInputs, languageName } from "../prompts/yaml-prompts.js";
import { nodeOf, locateTarget, projectNumberCatalog, invalid } from "../../shared/task_contract.js";
import { aiProjection, validateShape, prepareContent } from "./content.js";
import { numberedScript, scriptParagraphs, paragraphNumber } from "./script-split.js";
import { shotCharacterContext } from "../../shared/node-dependencies.js";

function previousSplit(project) {
  let start = 0;
  return { 剧集: [...project.episodes].sort((a, b) => a.sequence - b.sequence).map(episode => {
    const count = scriptParagraphs(episode.plot).length;
    const row = { 序号: episode.sequence, 起始段落: paragraphNumber(start), 结束段落: paragraphNumber(Math.max(start, start + count - 1)), 预估时长秒: episode.duration_seconds };
    start += count;
    return row;
  }) };
}

function shotTableForPrompt(value) {
  const fields = ["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"];
  return { shots: (value?.shots || []).map(shot => Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])])))};
}

function candidateForPrompt(business, value) {
  if (["project-summary", "episode-summary"].includes(business)) return value?.body || "";
  if (business === "project-characters") {
    const fields = ["name", "position", "age_range", "body_type", "hairstyle", "signature_props", "immutable_traits"];
    return { characters: (value?.changes || value?.characters || []).map(character => ({
      ...Object.fromEntries(fields.map(key => [key, character[key]])),
      costumes: character.costumes.map(costume => Object.fromEntries(["name", "color", "material", "props"].map(key => [key, costume[key]]))),
    })) };
  }
  if (business === "shots") return shotTableForPrompt(value);
  return aiProjection(value || {});
}

export function promptValues(snapshot, task, draft, kind, step = null) {
  const project = snapshot.project, business = task.business_type;
  const { object, episode } = locateTarget(project, business, task.target_id);
  const catalog = projectNumberCatalog(project, episode?.id);
  const shots = episode ? [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence) : [];
  const previous = shots[shots.findIndex(shot => shot.id === object.id) - 1];
  const steps = snapshot.steps || [];
  const lastReview = steps.filter(item => item.task_id === task.id && item.kind === "review" && item.step_status === "rejected" && item.seq < (step?.seq ?? Infinity)).sort((a, b) => b.seq - a.seq)[0];
  const lastSplitTask = (snapshot.tasks || []).filter(item => item.id !== task.id && item.business_type === "script-split").sort((a, b) => b.queue_order - a.queue_order)[0];
  const rejectedSplit = lastSplitTask?.task_status === "rejected" && steps.filter(item => item.task_id === lastSplitTask.id && ["generate", "revise"].includes(item.kind) && item.step_status === "done").sort((a, b) => b.seq - a.seq)[0]?.result;
  const saved = nodeOf(project, business, task.target_id);
  const base = candidateForPrompt(business, draft || saved);
  return {
    输出语言: languageName(project.output_language),
    ...ruleInputs(project.rules, business, task.target_id),
    完整剧本: project.script.body,
    创作方向: project.creative_direction,
    本集要求: episode?.episode_requirements || "",
    本集时长秒: episode?.duration_seconds || 0,
    本镜参考时长秒: object.duration_seconds || 0,
    项目摘要: project.project_summary.body,
    剧情依据: project.creation_mode === "剧本" ? episode?.plot || "" : {
      creative_direction: project.creative_direction,
      previous_plot: project.episodes.filter(item => item.sequence < (episode?.sequence || 0)).map(item => item.story_outline.segments),
    },
    剧情依据优先级: project.creation_mode === "剧本" ? "以本集剧情（拆分后的剧本原文）为最高事实依据，不改事件与原台词。" : "以创作方向及已发生剧情为依据，保留既有事实。",
    本集分场边界: episode?.episode_requirements || "",
    创作方式: project.creation_mode,
    本集剧情: episode?.plot || "",
    本集故事小段: episode?.story_outline.segments || [],
    编号剧本: numberedScript(project.script.body),
    参考单集时长秒: project.reference_episode_duration_seconds,
    上一版切分: draft || (task.opinion && rejectedSplit) || previousSplit(project),
    项目角色库目录: catalog.characters,
    本镜镜头表: business === "seconds" || business === "storyboard" ? shotTableForPrompt({ shots: [object] }).shots[0] : {},
    本集角色资料: business === "shots" ? shotCharacterContext(project) : catalog.characters,
    本镜角色资料: catalog.characters.filter(character => object.on_screen_characters?.some(row => project.character_library.characters.find(item => item.id === row.character_id)?.number === character.number)),
    本镜每秒分镜: aiProjection(object.seconds_storyboard || {}),
    固定素材清单: catalog.characters.map(character => ({ number: character.number, has_image: character.has_image, costumes: character.costumes })),
    上一镜交接: previous ? aiProjection(previous.seconds_storyboard) : "",
    已有镜头编号目录: shots.map(shot => ({ number: shot.number, sequence: shot.sequence })),
    编号规则: "已有对象沿用原编号；新镜头 S 加连续数字，不复用已占用编号。人物和服装的编号由程序维护，不在本次角色输出中提供。",
    必出判定规则: "仅将完整剧本明确承担必要主线剧情的角色标为必出。",
    修改意见: [kind === "revise" ? lastReview?.result?.原因 || lastReview?.error_reason : "", task.opinion].filter(Boolean).join("\n"),
    待修订镜头表: business === "shots" ? base : "",
    基稿: base,
    待审核内容: candidateForPrompt(business, draft),
    当前内容: base,
  };
}

export function createTextHandler({ chat }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    // 无意见的重新生成从资料重新生成；自动修订/带意见修改才使用修订模板。
    const suffix = step.kind === "review" ? "review" : step.kind === "revise" || (task.action === "regenerate" && task.opinion?.trim()) ? "regenerate" : "generate";
    const template = await loadTemplate(`${task.business_type}-${suffix}`);
    const prompt = renderTemplate(template, promptValues(snapshot, task, draft, step.kind, step));
    await record({ prompt });
    const response = await chat({ system: prompt.system, prompt: prompt.user, signal, task, step, trace: prompt, record });
    let raw = response;
    if (prompt.output.type === "JSON") {
      if (typeof raw === "string") raw = parseJsonValue(raw);
      validateShape(raw, prompt.output.structure);
    } else if (typeof raw !== "string" || !raw.trim()) invalid("响应", "需为非空文本");
    if (step.kind === "review") return { result: raw, prompt };
    return { content: prepareContent(snapshot, task, raw), result: raw, prompt };
  };
}
