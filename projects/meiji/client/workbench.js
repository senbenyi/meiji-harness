import { renderSettings, renderModelSettings } from "../../drama/src/client/settings-ui.js";
import { loadLatestRecords } from './task-records.js';
import { modelOptions } from '../shared/models/settings_model.js';
import { projectDialog } from "../../drama/src/client/project-forms.js";
import { renderLibrary as libraryView } from "./library-ui.js";
import { createShell } from "./panel-shell.js";
import { mountGpuStatus } from "./gpu-status.js";
import {
  PanelContext,
  request,
  sendCommand,
  currentSessionId,
} from "./task-client.js";
import { renderTaskPanel, editor } from "./task-panel.js";
export function mount() {
  const shell = createShell(),
    stopGpuStatus = mountGpuStatus(shell.root),
    context = new PanelContext(),
    view = { page: "overview", tab: "script" },
    emptyBrand = shell.root.querySelector(".brand").textContent,
    report = (error) =>
      shell.status(typeof error === "string" ? error : error.message);
  let stream,
    session = null,
    disposed = false,
    initialized = false,
    paintedContext = "",
    paintVersion = 0,
    selection = null;
  const showLanguage = () => {
    shell.root.querySelector(".language").textContent =
      selection?.output_language === "en" ? "English" : "中文";
  };
  const saveSettings = async (patch) => {
    if (!selection) throw new Error("设置尚未加载");
    const next = { ...selection, ...patch };
    await request("models", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Meiji-Request": "1" },
      body: JSON.stringify({ settings: next }),
    });
    selection = next;
    showLanguage();
  };
  const loadSelection = async () => {
    const { settings } = await request("models");
    selection = { output_language: "zh-CN", ...settings };
    showLanguage();
  };
  const paint = () => {
    paintVersion++;
    const snapshot = context.read();
    if (view.page === "settings" && !snapshot) {
      shell.content.replaceChildren();
      const page = renderSettings(shell.content, {
        settings: selection,
        saveSettings,
        back: () => {
          view.page = "home";
          paint();
        },
      });
      void renderModels(page, false);
      showLanguage();
      return;
    }
    if (!snapshot) {
      shell.root.querySelector(".brand").textContent = emptyBrand;
      showLanguage();
      if (view.page === "library") return catalog();
      view.page = "home";
      shell.content.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "home-empty";
      const plus = document.createElement("button");
      plus.className = "create-large";
      plus.setAttribute("aria-label", "创建项目");
      const mark = document.createElement("span");
      mark.textContent = "＋";
      plus.append(mark);
      plus.onclick = create;
      empty.append(plus);
      shell.content.append(empty);
      return;
    }
    shell.root.querySelector(".brand").textContent = snapshot.project.basic_info.name;
    showLanguage();
    const key = JSON.stringify([
      context.token(),
      view.page,
      view.episode_id,
      view.tab,
      view.shot_id,
      view.shotTab,
      view.character_id,
      view.costume_id,
      view.task_id,
      view.library_tab,
      view.library_category,
      view.library_status,
    ]);
    const editors =
      key === paintedContext
        ? [...shell.content.querySelectorAll("dialog, .panel-dialog-overlay")]
        : [];
    const drafts =
      key === paintedContext
        ? [
            ...shell.content.querySelectorAll(
              'form[data-draft-key][data-dirty="true"]',
            ),
          ]
        : [];
    for (const node of [...editors, ...drafts]) node.remove();
    const renderToken = context.token();
    const applyGroups = (groups, revision, links) => {
      if (disposed || !context.valid(renderToken)) return false;
      const applied = context.mergeGroups(groups, revision, links);
      if (applied) paint();
      return applied;
    };
    renderTaskPanel(shell.content, snapshot, {
      session_id: session,
      valid: () => !disposed && context.valid(renderToken) && session === currentSessionId(),
      view,
      refresh,
      applyGroups,
      paint,
      onError: report,
      renderLibrary: (root) => renderLibrary(root),
      settings: selection,
      saveSettings,
      renderModels: (root, busy) => renderModels(root, busy),
    });
    shell.content.append(...editors);
    for (const form of drafts) {
      const fresh = [
        ...shell.content.querySelectorAll("form[data-draft-key]"),
      ].find((n) => n.dataset.draftKey === form.dataset.draftKey);
      fresh?.replaceWith(form);
    }
    const busy = snapshot.tasks.some((t) => t.task_status === "running");
    for (const dialog of editors.filter((n) => n.tagName === "DIALOG")) {
      for (const input of dialog.querySelectorAll("input,textarea,select"))
        input.disabled = busy;
      const save = [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === "保存",
      );
      if (save) save.disabled = busy;
    }
    for (const form of drafts)
      for (const input of form.querySelectorAll("input,textarea,select,button"))
        input.disabled = busy;
    paintedContext = key;
  };
  const clearProject = () => {
    stream?.close();
    stream = null;
    context.select(session, null);
    delete view.taskRecords; delete view.recordVersions;
    Object.assign(view, {
      page: "home", library_tab: "projects", task_id: null,
      target_id: null, episode_id: null, shot_id: null,
      character_id: null, costume_id: null,
    });
    paintedContext = "";
    shell.root.querySelector(".brand").textContent = emptyBrand;
    showLanguage();
  };
  const refresh = async () => {
    if (disposed || document.hidden) return;
    await loadSelection().catch(report);
    const token = context.token(),
      result = await request(
        "context?session_id=" + encodeURIComponent(session || ""),
      );
    if (
      disposed ||
      token.epoch !== context.token().epoch ||
      session !== currentSessionId()
    )
      return;
    // 页面重载只读取服务端任务快照；生成生命周期由后端和 AI 服务端管理。
    if (!initialized) {
      initialized = true;
      if (disposed || token.epoch !== context.token().epoch || session !== currentSessionId()) return;
    }
    if (!result.snapshot) {
      const page = view.page;
      clearProject();
      if (page === "library" || page === "settings") view.page = page;
      return paint();
    }
    if (result.project_id !== context.token().project_id) {
      context.select(session, result.project_id);
      delete view.taskRecords; delete view.recordVersions;
      view.page = "overview";
      view.target_id = null;
    }
    if (result.snapshot && context.accept(context.token(), result.snapshot)) {
      paint();
      subscribe(result.project_id);
      if (await loadLatestRecords(context)) paint();
    }
  };
  const subscribe = (projectId) => {
    if (disposed || document.hidden) return;
    if (stream?.projectId === projectId) return;
    stream?.close();
    stream = new EventSource(
      "/api/meiji/events?" +
        new URLSearchParams({ session_id: session, project_id: projectId }),
    );
    stream.projectId = projectId;
    stream.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.project_id !== context.token().project_id) return;
      if ((data.revision || 0) < (context.read()?.runtime.revision || 0)) return;
      // 任务状态走本组快照；只有项目正文变化才重新读取整份项目。
      if (data.record) {
        context.recordChanged(data.record);
        view.recordVersions ??= {};
        view.recordVersions[data.record.group_id] = (view.recordVersions[data.record.group_id] || 0) + 1;
        if (view.page === 'history') paint();
        return;
      }
      if (context.mergeGroups(data.groups, data.revision, data.links)) paint();
      if (data.content || !Array.isArray(data.groups)) void refresh().catch(report);
    };
    stream.onerror = () => report("连接恢复中，操作结果以已保存数据为准");
  };
  const openProject = async (p) => {
    try {
      const result = await sendCommand(
        session,
        { type: "open", project_id: p.id },
        true,
      );
      session = result.session_id;
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: session }),
      );
      window.location.reload();
      context.select(session, p.id);
      await refresh();
    } catch (e) {
      report(e);
    }
  };
  const removeProject = async (p) => {
    const token = context.token();
    try {
      await sendCommand(
        session,
        { type: "delete", project_id: p.id, request_id: crypto.randomUUID() },
        true,
      );
      if (disposed || token.epoch !== context.token().epoch ||
        token.session_id !== currentSessionId()) return;
      const listing = view.page === "library";
      if (p.id === token.project_id) clearProject();
      if (listing) view.page = "library";
      if (view.page === "library") await catalog();
      else paint();
    } catch (e) {
      report(e);
    }
  };
  const catalog = async () => {
    const version = ++paintVersion,
      token = context.token();
    return libraryView(shell.content, {
      state: view,
      valid: () =>
        !disposed &&
        version === paintVersion &&
        token.epoch === context.token().epoch,
      paint: () => catalog().catch(report),
      report,
      open: openProject,
      remove: removeProject,
      create,
    });
  };
  const create = () =>
    projectDialog(shell.content, async (fields) => {
      const result = await sendCommand(
        session,
        { type: "create", request_id: crypto.randomUUID(), fields },
        true,
      );
      session = result.session_id;
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: session }),
      );
      window.location.reload();
      context.select(session, result.project_id);
      delete view.taskRecords; delete view.recordVersions;
      await refresh();
    }, {
      listScripts: async () => (await request("library")).assets,
      readScript: async (id) => {
        const response = await fetch("/api/meiji/library/" + encodeURIComponent(id));
        if (!response.ok) throw Error("剧本读取失败");
        return response.text();
      },
    });
  const renderModels = async (root, busy) => {
    const token = context.token(),
      version = paintVersion;
    try {
      const { settings } = await request("models");
      if (
        disposed ||
        token.epoch !== context.token().epoch ||
        version !== paintVersion ||
        view.page !== "settings"
      )
        return;
      selection = { output_language: "zh-CN", ...settings };
      showLanguage();
      const language = root.querySelector("[name=output_language]");
      if (language) {
        language.value = selection.output_language;
        language.dataset.saved = selection.output_language;
        language.disabled = busy;
      }
      renderModelSettings(root, { settings, modelOptions, busy, saveSettings });
    } catch (error) {
      report(error);
    }
  };
  const renderLibrary = async (root) => {
    const token = context.token(),
      version = paintVersion;
    try {
      await libraryView(root, {
        state: view,
        valid: () =>
          !disposed &&
          token.epoch === context.token().epoch &&
          version === paintVersion,
        paint,
        report,
        open: openProject,
        remove: removeProject,
        create,
        back: () => {
          view.page = "overview";
          paint();
        },
        busy: context.read()?.tasks.some((t) => t.task_status === "running"),
      });
    } catch (e) {
      report(e);
    }
  };
  shell.root.querySelector(".plus").onclick = create;
  shell.root.querySelector(".brand").onclick = () => {
    view.page = context.read() ? "overview" : "home";
    paint();
  };
  shell.root.querySelector(".library").onclick = () => {
    view.page = "library";
    paint();
  };
  shell.root.querySelector(".settings").onclick = () => {
    view.page = "settings";
    paint();
  };
  shell.root.querySelector(".language").onclick =
    shell.root.querySelector(".settings").onclick;
  const follow = () => {
    if (document.hidden) return;
    const next = currentSessionId();
    if (!disposed && next !== session) {
      session = next;
      stream?.close();
      stream = null;
      context.select(next, null);
      delete view.taskRecords; delete view.recordVersions;
      void refresh().catch(report);
    }
  };
  follow();
  const visibilityChanged = () => {
    if (document.hidden) {
      stream?.close();
      stream = null;
    } else {
      follow();
      void refresh().catch(report);
    }
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  const timer = setInterval(follow, 500);
  void refresh().catch(report);
  return {
    shell,
    context,
    view,
    refresh,
    dispose() {
      disposed = true;
      stopGpuStatus();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      stream?.close();
      shell.dispose();
    },
  };
}
