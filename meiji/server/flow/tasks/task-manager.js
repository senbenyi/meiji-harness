import { upstreamFailure, revisionProgress } from '../../handlers/repair-policy.js';
import { videoType, videoPack } from '../../../shared/video-inputs.js';
import { taskName, groupName } from "../../../shared/task-labels.js";
import {
  createId,
  validateCommand,
  locateTarget,
  nodeOf,
  TERMINAL_TASKS,
  invalid,
} from "../../../shared/task_contract.js";
import {
  enqueueNode,
  setNodeState,
  hasNodeContent,
} from "../../../shared/node-state.js";
import { expireDownstream, isNodeCurrent } from "../../../shared/node-dependencies.js";
import { stepKinds, newStep, reviewTypes, reviewType } from "../../../shared/task-plan.js";
import { taskDetail, groupDetail } from "../../data/task-store.js";
import { createTaskGroupModel } from "../../../shared/models/task_group_model.js";
import { createTaskModel } from "../../../shared/models/task_model.js";
import { BUSINESS_DEFINITIONS } from "../../../shared/node-definitions.js";
import { precheck } from "./precheck.js";
const now = () => new Date().toISOString();
const unfinished = (t) => ["queued", "running"].includes(t.task_status);
const conflict = (tasks) => {
  throw Object.assign(new Error("目标已有未结束任务"), {
    status: 409,
    code: "TASK_CONFLICT",
    conflicts: tasks.map((t) => ({
      task_id: t.id,
      business_type: t.business_type,
      target_id: t.target_id,
    })),
  });
};

export class TaskService {
  #repository;
  #execute;
  #commitOutput;
  #active = new Map();
  #deleting = new Set();
  #disposed = false;
  #libraryReferences;
  constructor({
    repository,
    execute,
    commitOutput,
    libraryReferences = async () => [],
  }) {
    this.#repository = repository;
    this.#execute = execute;
    this.#commitOutput = commitOutput;
    this.#libraryReferences = libraryReferences;
  }
  async command(command, origin = { source: "panel", session_id: null }) {
    validateCommand(command);
    if (this.#disposed) throw new Error("任务服务已关闭");
    const model = await this.#repository.open(command.project_id);
    if (command.type === "query") {
      if (command.task_id) return taskDetail(model, command.task_id);
      if (command.group_id) return groupDetail(model, command.group_id);
      return model.read();
    }
    let cancelling = null;
    const result = await model.update(command.request_id, command, (s) => {
      if (this.#deleting.has(command.project_id)) invalid("project", "项目正在删除");
      const active = s.tasks.find((t) => t.task_status === "running");
      const add = (
        business,
        id,
        action = command.action || "generate",
        group = null,
        index = null,
        opinion = command.opinion || "",
      ) =>
        this.#add(
          s,
          business,
          id,
          action,
          origin,
          group,
          index,
          opinion,
          command.type === "manual-edit" ? command.content : null,
        );
      if (command.type === "submit") {
        const related = s.tasks
            .filter(
              (t) =>
                t.business_type === command.business_type &&
                t.target_id === command.target_id,
            )
            .sort((a, b) => b.queue_order - a.queue_order),
          retryable = (t) =>
            ["failed", "rejected", "cancelled", "superseded"].includes(
              t?.task_status,
            ),
          latest = related[0],
          retrying =
            origin.source === "panel" &&
            retryable(latest);
        const old = s.tasks.find(
          (t) =>
            unfinished(t) &&
            t.business_type === command.business_type &&
            t.target_id === command.target_id,
        );
        if (old) {
          return { task_id: old.id };
        }
        return {
          task_id: add(
            command.business_type,
            command.target_id,
            retrying && command.action === "generate"
              ? hasNodeContent(s.project, command.business_type, command.target_id) ? "regenerate" : "generate"
              : command.action,
          ).id,
        };
      }
      if (command.type === "submit-costumes") {
        const characters = command.target_id
          ? [s.project.character_library.characters.find(c => c.id === command.target_id)].filter(Boolean)
          : s.project.character_library.characters;
        if (command.target_id && !characters.length) invalid("target_id", "角色不存在");
        if (!characters.length) invalid("target_id", "还没有人物");
        const ids = characters.flatMap(character => character.costumes.length ? character.costumes.map(c => c.id) : [character.id]);
        const prospective = structuredClone(s), planned = [];
        for (const id of ids) {
          if (command.action === "generate" && isNodeCurrent(prospective, "costume-image", id)) continue;
          planned.push(id);
          expireDownstream(prospective, "costume-image", id, "前序定妆照将更新", { compareHash: false });
        }
        const collisions = s.tasks.filter(t => unfinished(t) && t.business_type === "costume-image" && ids.includes(t.target_id));
        if (collisions.length) conflict(collisions);
        if (!planned.length) return { group_id: null, task_ids: [], message: "定妆照已生成" };
        const group = createTaskGroupModel({ project_id: s.project.id, group_type: "workflow",
          name: characters.length === 1 ? `${characters[0].name} · 定妆照` : "定妆照", action: command.action, source: origin.source });
        s.groups.push(group);
        const tasks = planned.map((id, index) => add("costume-image", id,
          hasNodeContent(s.project, "costume-image", id) ? "regenerate" : "generate", group.id, index + 1));
        return { group_id: group.id, task_ids: tasks.map(t => t.id) };
      }
      if (["manual-edit", "override", "delete"].includes(command.type)) {
        if (active) conflict([active]);
        const old = s.tasks.filter(
          (t) =>
            unfinished(t) &&
            t.business_type === command.business_type &&
            t.target_id === command.target_id,
        );
        if (old.length) conflict(old);
        return {
          task_id: add(
            command.business_type,
            command.target_id,
            {
              "manual-edit": "manual_edit",
              override: "override",
              delete: "delete",
            }[command.type],
          ).id,
        };
      }
      if (["submit-group", "continue-group"].includes(command.type)) {
        const original =
          command.type === "continue-group"
            ? s.groups.find((g) => g.id === command.group_id)
            : null;
        if (command.type === "continue-group" && !original)
          invalid("group_id", "组合不存在");
        if (original) {
          const members = s.tasks.filter(t => t.group_id === original.id).sort((a,b)=>a.group_seq-b.group_seq);
          if (members.some(unfinished)) conflict(members.filter(unfinished));
          const stoppedAt = members.findIndex(t => t.task_status !== "completed");
          const rest = stoppedAt < 0 ? [] : members.slice(stoppedAt);
          const remaining = rest.filter(t => !['first-last-frame','multimodal'].includes(t.business_type) || !rest.some(next => next.business_type === 'video' && next.target_id === t.target_id));
          if (remaining.some(t => (!BUSINESS_DEFINITIONS[t.business_type] || BUSINESS_DEFINITIONS[t.business_type].retired) || ["manual_edit", "override", "delete"].includes(t.action)))
            invalid("group", "历史已移除业务、人工与删除任务不能继续，请从对应入口重新操作");
          if (!remaining.length) return { group_id: null, task_ids: [], message: "当前范围无需继续" };
          const conflicts = s.tasks.filter(t => unfinished(t) && remaining.some(x => x.business_type === t.business_type && x.target_id === t.target_id));
          if (conflicts.length) conflict(conflicts);
          const group = createTaskGroupModel({ ...original, id: createId("group"), name: `${original.name || groupName(original, members, s.project)} · 继续`, created_at: now(), source: origin.source, action: "continue" });
          s.groups.push(group);
          const tasks = remaining.map((t,i) => add(t.business_type, t.target_id,
            hasNodeContent(s.project,t.business_type,t.target_id) ? "regenerate" : "generate",
            group.id, i+1, ""));
          return { group_id: group.id, task_ids: tasks.map(t=>t.id) };
        }
        const episodeId = command.episode_id,
          episode = s.project.episodes.find((e) => e.id === episodeId);
        if (!episode) invalid("episode_id", "剧集不存在");
        if (command.shot_id && !episode.shot_list.shots.some(x => x.id === command.shot_id))
          invalid("shot_id", "镜头不存在或不属于当前剧集");
        const type = command.group_type,
          action = command.action ?? "generate",
          scope =
            [...episode.shot_list.shots].filter(x => !command.shot_id || x.id === command.shot_id)
              .sort((a, b) => a.sequence - b.sequence)
              .map((x) => x.id),
          planned = [],
          prospective = structuredClone(s);
        if (action === "generate")
          for (const task of s.tasks.filter(task => unfinished(task) && task.episode_id === episodeId &&
            s.groups.some(group => group.id === task.group_id && group.group_type === "episode-film")))
            expireDownstream(prospective, task.business_type, task.target_id, "队列前序即将重新生成", { compareHash: false });
        for (const id of scope)
          for (const business of type === "episode-seconds"
             ? ["seconds"]
             : ["seconds", "storyboard", "video"]) {
            if (action === "generate" && isNodeCurrent(prospective, business, id)) continue;
            planned.push({ business, id });
            expireDownstream(prospective, business, id, "本组前序即将重新生成", { compareHash: false });
          }
        const assemblyOnly = type === "episode-film" && !planned.length && this.#needsAssembly(s, episode);
        if (!planned.length && !assemblyOnly)
          return { group_id: null, task_ids: [], message: "当前范围无需继续" };
        const conflicts = s.tasks.filter(
          (t) =>
            unfinished(t) &&
            (planned.some(
              (x) => x.business === t.business_type && x.id === t.target_id,
            ) || (type === "episode-film" && t.business_type === "assembly" && t.target_id === episodeId)),
        );
        if (conflicts.length) conflict(conflicts);
        const group = createTaskGroupModel({
          name: "",
          project_id: s.project.id,
          episode_id: episodeId,
          group_type: type,
          source: origin.source,
          shot_ids: scope,
          created_at: now(),
          action,
        });
        group.name = groupName(group, [], s.project);
        s.groups.push(group);
        const tasks = planned.map((x, i) =>
          add(
            x.business,
            x.id,
            hasNodeContent(s.project, x.business, x.id) ? "regenerate" : "generate",
            group.id,
            i + 1,
            command.opinion || "",
          ),
        );
        if (assemblyOnly) tasks.push(this.#appendAssembly(s, group, origin));
        return { group_id: group.id, task_ids: tasks.map((t) => t.id) };
      }
      const task = s.tasks.find((t) => t.id === command.task_id);
      if (!task) invalid("task_id", "任务不存在");
      if (command.type === "cancel") {
        if (!unfinished(task)) return { task_id: task.id, already_terminal: true };
        if (active) cancelling = this.#active.get(command.project_id);
        // 一次事务结算当前项目全部任务；后续提交不属于此次取消范围。
        for (const pending of s.tasks.filter(unfinished).sort((a, b) => b.queue_order - a.queue_order))
          this.#finish(s, pending, "cancelled",
            pending.business_type === "video" && pending.task_status === "running"
              ? "用户取消；仅停止本地等待，远端视频可能仍在运行"
              : "用户取消项目全部任务");
        return { task_id: task.id };
      }
      invalid("command", "未实现命令");
    });
    cancelling?.controller.abort(new Error("用户取消"));
    this.#pump(model);
    return result;
  }
  #notice(s, task, event, status, reason, sessionId) {
    s.runtime.outbox.push({
      id: `notice_${globalThis.crypto.randomUUID()}`,
      session_id: sessionId,
      project_id: s.project.id,
      task_id: task.id,
      group_id: task.group_id,
      event,
      status,
      reason,
      delivery_status:
        task.source === "session" && event === "submitted"
          ? "silent"
          : "pending",
      error: "",
    });
  }
  #add(
    s,
    business,
    id,
    action,
    origin,
    group = null,
    index = null,
    opinion = "",
    content = null,
  ) {
    const target = locateTarget(s.project, business, id);
    const family = ['video', 'first-last-frame', 'multimodal'];
    if (family.includes(business)) {
      const occupied = s.tasks.filter(task => unfinished(task) && task.target_id === id && family.includes(task.business_type) && task.group_id !== group);
      if (occupied.length) conflict(occupied);
    }
    if (business === "assembly") {
      const producing = s.tasks.filter(task => unfinished(task) && task.group_id !== group && task.episode_id === id &&
        s.groups.some(item => item.id === task.group_id && item.group_type === "episode-film"));
      if (producing.length) conflict(producing);
    }
    if (business === "costume-image" && !target.object && target.character.costumes.length)
      invalid("target_id", "已有明确服装，请选择对应服装生成定妆照");
    const node = nodeOf(s.project, business, id);
    const previous = business === "script-split"
      ? s.tasks.filter(t => t.business_type === business && t.target_id === id).sort((a,b)=>b.queue_order-a.queue_order)[0]
      : null;
    // 剧本的未通过原因是给剧本的修改意见：按意见修改时带上，重新审核不把它当作本次审核要求。
    const rejectedReason = business === "script-review" && action !== "revise" ? ""
      : node?.node_state.status === "rejected" ? node.node_state.reason
      : previous?.task_status === "rejected" ? previous.end_reason : "";
    if (["generate", "regenerate", "revise", "continue"].includes(action) && rejectedReason && !opinion.includes(rejectedReason))
      opinion = [rejectedReason, opinion].filter(Boolean).join("\n");
    const task = createTaskModel({
        name: "",
        project_id: s.project.id,
        episode_id: target.episode?.id || null,
        business_type: business,
        target_id: id,
        action,
        group_id: group,
        group_seq: index,
        task_status: "queued",
        source: origin.source,
        queue_order: Math.max(0, ...s.tasks.map((t) => t.queue_order)) + 1,
        end_reason: "",
        created_at: now(),
        started_at: null,
        ended_at: null,
        opinion,
        previous_node_state: null,
      });
    task.name = taskName(task, s.project);
    if (!task.group_id) {
      const group = createTaskGroupModel({
        name: "",
        project_id: s.project.id,
        episode_id: task.episode_id,
        group_type: ["project-characters", "script-split"].includes(business) ? "workflow" : "single",
        source: origin.source, shot_ids: [], created_at: task.created_at,
        action,
      });
      group.name = groupName(group, [task], s.project);
      task.group_id = group.id;
      task.group_seq = 1;
      s.groups.push(group);
    }
    enqueueNode(s.project, task);
    s.tasks.push(task);
    const reviewers = reviewTypes(task);
    s.steps.push(
      ...stepKinds(task).map((kind, i) => {
        const st = newStep(task, i + 1, kind, 0, kind === "review" ? reviewers.shift() : null);
        if (kind === "manual_edit")
          st.result = { input: structuredClone(content) };
        return st;
      }),
    );
    this.#notice(s, task, "submitted", "queued", "", origin.session_id || null);
    return task;
  }
  #finish(s, task, status, reason = "") {
    if (TERMINAL_TASKS.includes(task.task_status)) return;
    const node = nodeOf(s.project, task.business_type, task.target_id);
    task.task_status = status;
    task.end_reason = reason;
    task.ended_at = now();
    if (node && ["completed", "rejected"].includes(status))
      setNodeState(node, status === "completed" ? "generated" : "rejected", reason);
    if (task.business_type === 'video' && ['completed', 'rejected'].includes(status)) {
      const shot = locateTarget(s.project, 'video', task.target_id).object;
      Object.assign(shot.last_frame.node_state, { status: status === 'completed' ? 'generated' : 'rejected', reason: status === 'completed' ? '' : reason, fail_message: '' });
    }
    for (const step of s.steps.filter(
      (st) =>
        st.task_id === task.id && ["ready", "running"].includes(st.step_status),
    )) {
      step.step_status = "cancelled";
      step.ended_at = now();
    }
    const origin = s.runtime.outbox.find(
      (n) => n.task_id === task.id && n.event === "submitted",
    );
    this.#notice(s, task, status, status, reason, origin?.session_id || null);
    if (["failed", "rejected"].includes(status))
      for (const pending of s.tasks.filter(t => t.task_status === "queued").sort((a,b) => b.queue_order-a.queue_order))
        this.#finish(s, pending, "cancelled", "项目前序任务失败或未通过，取消剩余任务");
  }

  current(model) {
    const tasks = model.read().tasks.filter(unfinished).sort((a,b) => a.queue_order-b.queue_order);
    return { status: tasks.some(t => t.task_status === "running") ? "running" : tasks.length ? "queued" : "idle", tasks };
  }
  #pump(model) {
    if (
      this.#disposed ||
      this.#deleting.has(model.id) ||
      this.#active.has(model.id)
    )
      return;
    const controller = new AbortController(),
      entry = { controller, promise: null };
    this.#active.set(model.id, entry);
    entry.promise = this.#loop(model, controller.signal)
      .catch((error) => {
        entry.error = error;
      })
      .finally(() => {
        this.#active.delete(model.id);
        if (
          !this.#disposed &&
          this.current(model).tasks.some(t => t.task_status === "queued")
        )
          this.#pump(model);
      });
  }
  async #loop(model, signal) {
    while (!this.#disposed && !signal.aborted) {
      const before = model.read();
      const task = this.current(model).tasks.find(t => t.task_status === "queued");
      if (!task) return;
      if (task.business_type === 'video' && !['manual_edit','override'].includes(task.action)) {
        const inserted = await model.update(`prepare-video:${task.id}:${before.runtime.revision}`, { prepareVideo: task.id }, s => {
          const t = s.tasks.find(item => item.id === task.id);
          if (t.task_status !== 'queued') return { inserted: false };
          const { object: shot, episode } = locateTarget(s.project, 'video', t.target_id);
          if (!isNodeCurrent(s, 'shots', episode.id) || !isNodeCurrent(s, 'storyboard', shot.id)) return { inserted: false };
          const type = videoType(episode, shot), business = videoPack(type);
          shot.video_generation_type = type;
          if (!business || isNodeCurrent(s, business, shot.id)) return { inserted: false };
          const order = t.queue_order, seq = t.group_seq;
          // 新编排插到待生成视频之前；只调整尚未开始的队列和本组顺序。
          for (const row of s.tasks.filter(item => item.task_status === 'queued')) {
            if (row.queue_order >= order) row.queue_order++;
            if (row.group_id === t.group_id && row.group_seq >= seq) row.group_seq++;
          }
          const pack = this.#add(s, business, shot.id, hasNodeContent(s.project, business, shot.id) ? 'regenerate' : 'generate',
            { source: t.source, session_id: null }, t.group_id, seq);
          pack.queue_order = order;
          return { inserted: true };
        });
        if (inserted.inserted) continue;
      }
      if (signal.aborted) return;
      const started = await model.update(`start:${task.id}`, { start: task.id }, (s) => {
        const t = s.tasks.find((t) => t.id === task.id);
        if (t.task_status !== "queued") return { started: false };
        t.task_status = "running";
        t.started_at = now();
        return { started: true };
      });
      if (!started.started) continue;
      try {
        await this.#run(model, task.id, signal);
      } catch (error) {
        // 取消由命令结算，关闭由 recover 结算；中断请求不是模型失败。
        if (signal.aborted) return;
        const status = ["INVALID_CONTRACT", "INVALID_MODEL_JSON"].includes(error.code) ? "rejected" : "failed";
        await model.update(
          `fail:${task.id}`,
          { failure: error.message },
          (s) => {
            const t = s.tasks.find((t) => t.id === task.id);
            if (t.task_status !== "running") return {};
            const st = s.steps.find(
              (x) => x.task_id === t.id && x.step_status === "running",
            );
            if (st) {
              st.step_status = status;
              st.error_reason = error.message;
              st.ended_at = now();
            }
            this.#finish(s, t, status, error.message);
            return {};
          },
        );
      }
    }
  }
  async #run(model, id, signal) {
    let draft = null;
    let validationFailure = "";
    const initial = model.read();
    const current = initial.tasks.find(t => t.id === id);
    if (current.business_type === "script-split") {
      const previous = initial.tasks.filter(t => t.id !== id && t.business_type === current.business_type && t.target_id === current.target_id)
        .sort((a,b)=>b.queue_order-a.queue_order)[0];
      if (previous?.task_status === "rejected")
        draft = initial.steps.filter(st => st.task_id === previous.id && ["generate", "revise"].includes(st.kind) && st.step_status === "done")
          .sort((a,b)=>b.seq-a.seq)[0]?.result ?? null;
    }
    while (!signal.aborted) {
      const snapshot = model.read(),
        task = snapshot.tasks.find(t => t.id === id);
      if (task.task_status !== "running") return;
      const step = snapshot.steps.filter(st => st.task_id === id && st.step_status === "ready").sort((a,b)=>a.seq-b.seq)[0];
      if (!step) return;
      await model.update(`step-start:${step.id}`, { step: step.id }, s => {
        const st = s.steps.find(x => x.id === step.id);
        st.step_status = "running";
        st.started_at = now();
        return {};
      });
      const record = async patch => {
        if (signal.aborted) return;
        await model.update(`record:${step.id}:${createId("step")}`, { step: step.id, patch }, s => {
          const t = s.tasks.find(x => x.id === id), st = s.steps.find(x => x.id === step.id);
          if (t.task_status === "running" && st.step_status === "running") Object.assign(st, patch);
          return {};
        });
      };
      const fresh = model.read();
      const context = { snapshot: fresh, task, step, draft, reviewType: reviewType(step), signal, record };
      let output;
      if (step.kind === "review" && validationFailure) {
        output = { result: { 是否通过: false, 原因: validationFailure } };
      } else if (step.kind === "precheck") {
        output = { result: precheck(fresh, task, { libraryReferences: await this.#libraryReferences() }) };
        if (task.business_type === "assembly" && ["generate", "regenerate", "continue"].includes(task.action))
          output = await this.#execute(context);
      } else output = await this.#execute(context);
      if (signal.aborted || model.read().tasks.find(t => t.id === id).task_status !== "running") return;
      if (["generate", "revise"].includes(step.kind)) validationFailure = output.validationFailure || "";
      if (["generate", "revise", "manual_edit", "apply"].includes(step.kind) || (step.kind === "review" && output.content !== undefined)) draft = output.content;
      await model.update(`step-end:${step.id}`, { step: step.id }, s => {
        const t = s.tasks.find(x => x.id === id), st = s.steps.find(x => x.id === step.id);
        if (t.task_status !== "running") return {};
        Object.assign(st, {
          step_status: "done", result: output.result ?? output.content ?? null,
          prompt: output.prompt ?? st.prompt, ended_at: now(),
        });
        if (["generate", "revise"].includes(step.kind) && validationFailure) {
          const next = s.steps.filter(x => x.task_id === id && x.step_status === "ready").sort((a,b) => a.seq-b.seq)[0];
          if (!next || next.kind !== "review" || reviewType(next) !== "program") {
            for (const pending of s.steps.filter(x => x.task_id === id && x.step_status === "ready")) pending.seq++;
            s.steps.push(newStep(t, step.seq + 1, "review", step.round, "program"));
          }
        }
        if (step.kind === "review") {
          const review = output.result;
          if (typeof review?.是否通过 !== "boolean" || typeof review?.原因 !== "string" ||
              (review.是否通过 ? Boolean(review.原因.trim()) : !review.原因.trim()))
            invalid("review", "审核协议错误");
          if (!review.是否通过) {
            st.step_status = "rejected";
            st.error_reason = review.原因;
            for (const pending of s.steps.filter(x => x.task_id === id && x.step_status === "ready")) {
              pending.step_status = "cancelled";
              pending.ended_at = now();
            }
            const upstream = upstreamFailure(s.project, t, review);
            const progress = revisionProgress(s, t, step, review);
            if (progress) st.result = { ...review, 修订进展: progress };
            if (upstream || progress?.重复程序错误 || (progress?.重复审核意见 && t.business_type !== "script-review")) {
              // 上游问题和无进展不提交本轮候选，不污染原正式内容及依赖。
              const reason = upstream || progress.提示;
              st.error_reason = reason;
              this.#finish(s, t, "rejected", reason);
              return {};
            }
            // 剧本审核任务只审核；只有按意见修改的任务才在未通过时继续修改。
            const reviewOnly = t.business_type === "script-review" && t.action !== "revise";
            if (!reviewOnly && step.round < BUSINESS_DEFINITIONS[t.business_type].retryRounds) {
              const round = step.round + 1;
              let seq = Math.max(...s.steps.filter(x => x.task_id === id).map(x => x.seq));
              s.steps.push(newStep(t, ++seq, "revise", round));
              if (t.business_type === 'video') s.steps.push(newStep(t, ++seq, 'apply', round));
              for (const reviewer of reviewTypes(t)) s.steps.push(newStep(t, ++seq, "review", round, reviewer));
              return {};
            }
            if (!validationFailure) this.#commitOutput(s, t, draft, { passed: false });
            this.#finish(s, t, "rejected", review.原因);
            return {};
          }
        }
        if (!s.steps.some(x => x.task_id === id && x.step_status === "ready")) {
          const content = ["generate", "revise", "review", "apply"].includes(step.kind) ? draft
            : step.kind === "override" && t.business_type === "script-split" ? output.content
            : step.kind === "override" ? null : output.content;
          const derived = this.#commitOutput(s, t, content, { passed: true });
          if (task.action !== "delete") expireDownstream(s, t.business_type, t.target_id);
          this.#finish(s, t, "completed");
          this.#derived(s, t, { ...output, derived });
        }
        return {};
      });
    }
  }
  #derived(s, t, output) {
    const origin = s.runtime.outbox.find(
        (n) => n.task_id === t.id && n.event === "submitted",
      ),
      source = { source: t.source, session_id: origin?.session_id || null };
    const parentGroup = s.groups.find(g => g.id === t.group_id);
    if (parentGroup?.group_type === "episode-film") {
      if (s.tasks.filter(task => task.group_id === parentGroup.id).every(task => task.task_status === "completed"))
        this.#appendAssembly(s, parentGroup, source);
      return;
    }
    const group = parentGroup && ["workflow", "single"].includes(parentGroup.group_type) ? parentGroup.id : null;
    const next = () => group ? Math.max(0, ...s.tasks.filter(x => x.group_id === group).map(x => x.group_seq)) + 1 : null;
    const derived = output.derived || [];
    const collisions = s.tasks.filter(task => unfinished(task) && derived.some(item =>
      task.business_type === item.business_type && task.target_id === item.target_id));
    if (collisions.length) conflict(collisions);
    for (const item of derived) {
      const node = nodeOf(s.project, item.business_type, item.target_id);
      const action = node && hasNodeContent(s.project, item.business_type, item.target_id) ? "regenerate" : "generate";
      this.#add(s, item.business_type, item.target_id, action, source, group, next());
    }
  }
  #needsAssembly(snapshot, episode) {
    return episode.shot_list.shots.length > 0 &&
      !snapshot.tasks.some(task => unfinished(task) && task.episode_id === episode.id &&
        snapshot.groups.some(group => group.id === task.group_id && group.group_type === "episode-film")) &&
      episode.shot_list.shots.every(shot => isNodeCurrent(snapshot, "video", shot.id)) &&
      !isNodeCurrent(snapshot, "assembly", episode.id);
  }
  #appendAssembly(snapshot, group, origin) {
    const members = snapshot.tasks.filter(task => task.group_id === group.id),
      episode = snapshot.project.episodes.find(item => item.id === group.episode_id);
    if (members.some(task => task.business_type === "assembly") || !this.#needsAssembly(snapshot, episode)) return null;
    const collisions = snapshot.tasks.filter(task => unfinished(task) && task.business_type === "assembly" && task.target_id === episode.id);
    if (collisions.length) conflict(collisions);
    return this.#add(snapshot, "assembly", episode.id,
      hasNodeContent(snapshot.project, "assembly", episode.id) ? "regenerate" : "generate",
      origin, group.id, members.length + 1);
  }
  async removeProject(projectId) {
    if (this.#deleting.has(projectId)) invalid("project", "项目正在删除");
    this.#deleting.add(projectId);
    try {
      const model = await this.#repository.open(projectId);
      await model.update(`delete-project:${createId("task")}`, { deleteProject: true }, s => {
        for (const task of s.tasks.filter(unfinished).sort((a, b) => b.queue_order - a.queue_order))
          this.#finish(s, task, "cancelled", "删除项目，取消未完成任务");
        return {};
      });
      this.#active.get(projectId)?.controller.abort(new Error("项目正在删除"));
      await this.idle(projectId);
      return await this.#repository.remove(projectId);
    } finally {
      this.#deleting.delete(projectId);
    }
  }
  async idle(projectId) {
    while (this.#active.has(projectId)) {
      const entry = this.#active.get(projectId);
      await entry.promise;
      if (entry.error) throw entry.error;
    }
  }
  async recover(model) {
    const snapshot = model.read();
    if (!snapshot.tasks.some(unfinished)) return;
    await model.update(
      `restart:${createId("task")}`,
      { restart: true },
      (s) => {
        // 从队尾结算，避免前序停止把后序改写成另一条原因。
        for (const task of s.tasks.filter(unfinished).sort((a, b) => b.queue_order - a.queue_order))
          this.#finish(
            s,
            task,
            "cancelled",
            task.business_type === "video" && task.task_status === "running"
              ? "服务重启，未完成任务已取消；远端视频可能仍在运行"
              : "服务重启，未完成任务已取消",
          );
        return {};
      },
    );
  }
  async dispose() {
    this.#disposed = true;
    const active = [...this.#active.entries()];
    for (const [, entry] of active)
      entry.controller.abort(new Error("服务关闭"));
    for (const [id] of active) {
      const model = await this.#repository.open(id);
      await this.recover(model);
    }
    await Promise.all(active.map(([, entry]) => entry.promise));
  }
}
