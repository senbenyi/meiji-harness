import {
  createId,
  validateCommand,
  locateTarget,
  nodeOf,
  TERMINAL_TASKS,
  invalid,
} from "../../../shared/task-contract.js";
import {
  enqueueNode,
  restoreQueued,
  setNodeState,
  assertOutput,
  TEXT_BUSINESSES,
} from "../../../shared/node-state.js";
import { expireDownstream } from "../../../shared/node-dependencies.js";
import { stepKinds, newStep } from "../../../shared/task-plan.js";
import { taskDetail, groupDetail } from "../../data/task-store.js";
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
    let cancelId = null;
    const result = await model.update(command.request_id, command, (s) => {
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
        // 面板拆分是明确的执行动作；只恢复拆分本身，不带起其他暂停任务。
        if (command.business_type === "script-split" && origin.source === "panel") {
          const others = s.tasks.filter(
            (t) => unfinished(t) &&
              !(t.business_type === "script-split" && t.target_id === command.target_id),
          );
          if (others.length) conflict(others);
          s.runtime.queue_stopped = false;
        }
        const old = s.tasks.find(
          (t) =>
            unfinished(t) &&
            t.business_type === command.business_type &&
            t.target_id === command.target_id,
        );
        if (old) return { task_id: old.id };
        return { task_id: add(command.business_type, command.target_id).id };
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
        const episodeId = original?.episode_id || command.episode_id,
          episode = s.project.剧集.find((e) => e.id === episodeId);
        if (!episode) invalid("episode_id", "剧集不存在");
        if (command.shot_id && !episode.镜头表.镜头.some(x => x.id === command.shot_id))
          invalid("shot_id", "镜头不存在或不属于当前剧集");
        const type = original?.group_type || command.group_type,
          scope =
            original?.shot_ids ||
            [...episode.镜头表.镜头].filter(x => !command.shot_id || x.id === command.shot_id)
              .sort((a, b) => a.序号 - b.序号)
              .map((x) => x.id),
          planned = [],
          prospective = structuredClone(s);
        for (const id of scope)
          for (const business of type === "episode-seconds"
            ? ["seconds"]
            : ["seconds", "storyboard", "video", "tail"]) {
            const node = nodeOf(prospective.project, business, id);
            let valid = false;
            try {
              assertOutput(prospective.project, business, id);
              valid = node.状态 === "generated";
            } catch {}
            if (command.type === "continue-group" && valid) continue;
            planned.push({ business, id });
            if (command.type === "continue-group")
              expireDownstream(prospective, business, id);
          }
        if (!planned.length)
          return { group_id: null, task_ids: [], message: "当前范围无需继续" };
        const conflicts = s.tasks.filter(
          (t) =>
            unfinished(t) &&
            planned.some(
              (x) => x.business === t.business_type && x.id === t.target_id,
            ),
        );
        if (conflicts.length) conflict(conflicts);
        const group = {
          id: createId("group"),
          project_id: s.project.id,
          episode_id: episodeId,
          group_type: type,
          source: origin.source,
          shot_ids: scope,
          created_at: now(),
          action: original ? "continue" : "generate",
          continued_from_group_id: original?.id || null,
          opinion: original?.opinion || command.opinion || "",
        };
        s.groups.push(group);
        const tasks = planned.map((x, i) =>
          add(
            x.business,
            x.id,
            original
              ? "continue"
              : nodeOf(s.project, x.business, x.id).状态 === "empty"
                ? "generate"
                : "regenerate",
            group.id,
            i + 1,
            group.opinion,
          ),
        );
        return { group_id: group.id, task_ids: tasks.map((t) => t.id) };
      }
      const task = s.tasks.find((t) => t.id === command.task_id);
      if (!task) invalid("task_id", "任务不存在");
      if (command.type === "start-queued") {
        if (origin.source !== "panel") invalid("source", "排队控制只允许面板");
        if (task.task_status !== "queued")
          invalid("task_status", "只能开始排队任务");
        if (active) conflict([active]);
        s.runtime.queue_stopped = false;
        const queue = s.tasks
          .filter((t) => t.task_status === "queued")
          .sort((a, b) => a.queue_order - b.queue_order);
        if (queue[0]?.id !== task.id) invalid("queue_order", "只能从队首开始");
        return { task_id: task.id };
      }
      if (["cancel", "remove-queued"].includes(command.type)) {
        if (
          command.type === "remove-queued" &&
          (origin.source !== "panel" || task.task_status !== "queued")
        )
          invalid("task_status", "只能从面板移除排队任务");
        if (!unfinished(task))
          return { task_id: task.id, already_terminal: true };
        if (task.task_status === "running") cancelId = task.id;
        this.#finish(
          s,
          task,
          "cancelled",
          task.business_type === "video" && task.task_status === "running"
            ? "用户取消；仅停止本地等待，远端视频可能仍在运行"
            : "用户取消",
        );
        return { task_id: task.id };
      }
      invalid("command", "未实现命令");
    });
    if (cancelId)
      this.#active
        .get(command.project_id)
        ?.controller.abort(new Error("用户取消"));
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
    const target = locateTarget(s.project, business, id),
      task = {
        id: createId("task"),
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
      };
    enqueueNode(s.project, task);
    s.tasks.push(task);
    s.steps.push(
      ...stepKinds(task).map((kind, i) => {
        const st = newStep(task, i + 1, kind);
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
    const started = task.task_status === "running",
      node = nodeOf(s.project, task.business_type, task.target_id);
    task.task_status = status;
    task.end_reason = reason;
    task.ended_at = now();
    if (node) {
      if (!started && ["cancelled", "superseded"].includes(status))
        restoreQueued(s.project, task);
      else
        setNodeState(
          node,
          {
            completed: "generated",
            rejected: "rejected",
            failed: "failed",
            cancelled: "cancelled",
            superseded: "cancelled",
          }[status],
          reason,
        );
    }
    for (const step of s.steps.filter(
      (st) =>
        st.task_id === task.id && ["ready", "running"].includes(st.step_status),
    )) {
      step.step_status = status === "cancelled" ? "cancelled" : "superseded";
      step.ended_at = now();
    }
    const origin = s.runtime.outbox.find(
      (n) => n.task_id === task.id && n.event === "submitted",
    );
    this.#notice(s, task, status, status, reason, origin?.session_id || null);
    if (status !== "completed") {
      s.runtime.queue_stopped = true;
      if (task.group_id)
        for (const later of s.tasks.filter(
          (t) =>
            t.group_id === task.group_id &&
            t.group_seq > task.group_seq &&
            t.task_status === "queued",
        ))
          this.#finish(s, later, "superseded", "组合前序任务已停止");
    }
  }
  #pump(model) {
    if (
      this.#disposed ||
      this.#active.has(model.id) ||
      model.read().runtime.queue_stopped
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
          !model.read().runtime.queue_stopped &&
          model.read().tasks.some((t) => t.task_status === "queued")
        )
          this.#pump(model);
      });
  }
  async #loop(model, signal) {
    while (!this.#disposed && !signal.aborted) {
      const before = model.read();
      if (before.runtime.queue_stopped) return;
      const task = before.tasks
        .filter((t) => t.task_status === "queued")
        .sort((a, b) => a.queue_order - b.queue_order)[0];
      if (!task) return;
      await model.update(`start:${task.id}`, { start: task.id }, (s) => {
        const t = s.tasks.find((t) => t.id === task.id);
        t.task_status = "running";
        t.started_at = now();
        const n = nodeOf(s.project, t.business_type, t.target_id);
        if (n) setNodeState(n, "running");
        return {};
      });
      try {
        await this.#run(model, task.id, signal);
      } catch (error) {
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
              st.step_status = "failed";
              st.error_reason = error.message;
              st.ended_at = now();
            }
            this.#finish(s, t, "failed", error.message);
            return {};
          },
        );
      }
    }
  }
  async #run(model, id, signal) {
    let draft = null,
      round = 0;
    while (!signal.aborted) {
      const snapshot = model.read(),
        task = snapshot.tasks.find((t) => t.id === id);
      if (task.task_status !== "running") return;
      const step = snapshot.steps
        .filter((st) => st.task_id === id && st.step_status === "ready")
        .sort((a, b) => a.seq - b.seq)[0];
      if (!step) return;
      await model.update(`step-start:${step.id}`, { step: step.id }, (s) => {
        const st = s.steps.find((x) => x.id === step.id);
        st.step_status = "running";
        st.started_at = now();
        return {};
      });
      const record = async (patch) => {
        if (signal.aborted) return;
        await model.update(
          `record:${step.id}:${createId("step")}`,
          { step: step.id, patch },
          (s) => {
            const t = s.tasks.find((x) => x.id === id),
              st = s.steps.find((x) => x.id === step.id);
            if (t.task_status === "running" && st.step_status === "running")
              Object.assign(st, patch);
            return {};
          },
        );
      };
      const fresh = model.read();
      let output;
      if (step.kind === "precheck")
        output = {
          result: precheck(fresh, task, {
            libraryReferences: await this.#libraryReferences(),
          }),
        };
      else
        output = await this.#execute({
          snapshot: fresh,
          task,
          step,
          draft,
          signal,
          record,
        });
      if (
        signal.aborted ||
        model.read().tasks.find((t) => t.id === id).task_status !== "running"
      )
        return;
      if (["generate", "revise"].includes(step.kind)) draft = output.content;
      await model.update(`step-end:${step.id}`, { step: step.id }, (s) => {
        const t = s.tasks.find((x) => x.id === id),
          st = s.steps.find((x) => x.id === step.id);
        if (t.task_status !== "running") return {};
        Object.assign(st, {
          step_status: "done",
          result: output.result ?? output.content ?? null,
          prompt: output.prompt ?? st.prompt,
          ended_at: now(),
        });
        if (step.kind === "review") {
          const review = output.result;
          if (
            typeof review?.通过 !== "boolean" ||
            typeof review.原因 !== "string" ||
            (review.通过 ? Boolean(review.原因.trim()) : !review.原因.trim())
          )
            invalid("review", "审核协议错误");
          if (!review.通过 && round < 2) {
            round++;
            s.steps.push(
              newStep(t, st.seq + 1, "revise", round),
              newStep(t, st.seq + 2, "review", round),
            );
            return {};
          }
          const derived =
            t.business_type === "script" && !review.通过
              ? []
              : this.#commitOutput(s, t, draft);
          if (review.通过) expireDownstream(s, t.business_type, t.target_id);
          this.#finish(
            s,
            t,
            review.通过 ? "completed" : "rejected",
            review.原因,
          );
          if (review.通过) this.#derived(s, t, { ...output, derived });
          return {};
        }
        const last = !s.steps.some(
          (x) => x.task_id === id && x.step_status === "ready",
        );
        if (last) {
          const derived = this.#commitOutput(
            s,
            t,
            step.kind === "override" ? null : output.content,
          );
          if (task.action !== "delete")
            expireDownstream(s, t.business_type, t.target_id);
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
    if (t.business_type === "script")
      this.#add(
        s,
        "project-summary",
        s.project.id,
        s.project.项目摘要.状态 === "empty" ? "generate" : "regenerate",
        source,
      );
    for (const item of output.derived || []) {
      if (
        !s.tasks.some(
          (t) =>
            unfinished(t) &&
            t.business_type === item.business_type &&
            t.target_id === item.target_id,
        )
      )
        this.#add(s, item.business_type, item.target_id, "generate", source);
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
    if (!snapshot.tasks.some(unfinished) && !snapshot.runtime.queue_stopped) return;
    await model.update(
      `restart:${createId("task")}`,
      { restart: true },
      (s) => {
        // 从队尾结算，确保组合后序也保留重启作废原因，而非前序停止原因。
        for (const task of s.tasks.filter(unfinished).sort((a, b) => b.queue_order - a.queue_order))
          this.#finish(
            s,
            task,
            "superseded",
            task.business_type === "video" && task.task_status === "running"
              ? "服务重启，未完成任务已作废；远端视频可能仍在运行"
              : "服务重启，未完成任务已作废",
          );
        s.runtime.queue_stopped = false;
        return {};
      },
    );
  }
  async dispose() {
    this.#disposed = true;
    for (const entry of this.#active.values())
      entry.controller.abort(new Error("服务关闭"));
    for (const id of this.#active.keys()) {
      const model = await this.#repository.open(id);
      await this.recover(model);
    }
    await Promise.all([...this.#active.values()].map((entry) => entry.promise));
  }
}
