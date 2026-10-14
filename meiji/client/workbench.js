import { modelOptions } from '../shared/models/settings_model.js';
import { projectDialog } from "./project-forms.js";
import { renderLibrary as libraryView } from "./library-ui.js";
import { createShell } from "./panel-shell.js";
import { element } from "./panel-dom.js";
import {
  PanelContext,
  request,
  sendCommand,
  currentSessionId,
} from "./task-client.js";
import { renderTaskPanel, editor } from "./task-panel.js";
export function mount() {
  const shell = createShell(),
    context = new PanelContext(),
    view = { page: "overview", tab: "script" },
    emptyBrand = shell.root.querySelector(".brand").textContent,
    report = (error) =>
      shell.status(typeof error === "string" ? error : error.message);
  let stream,
    session = null,
    disposed = false,
    paintedContext = "",
    paintVersion = 0;
  const paint = () => {
    paintVersion++;
    const snapshot = context.read();
    if (!snapshot) return catalog();
    shell.root.querySelector(".brand").textContent = snapshot.project.name;
    shell.root.querySelector(".language").textContent =
      snapshot.project.output_language === "en" ? "English" : "中文";
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
    renderTaskPanel(shell.content, snapshot, {
      session_id: session,
      view,
      refresh,
      paint,
      onError: report,
      renderLibrary: (root) => renderLibrary(root),
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
    Object.assign(view, {
      page: "library", library_tab: "projects", task_id: null,
      target_id: null, episode_id: null, shot_id: null,
      character_id: null, costume_id: null,
    });
    paintedContext = "";
    shell.root.querySelector(".brand").textContent = emptyBrand;
    shell.root.querySelector(".language").textContent = "中文";
  };
  const refresh = async () => {
    if (disposed || document.hidden) return;
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
    if (!result.snapshot) {
      clearProject();
      return catalog();
    }
    if (result.project_id !== context.token().project_id) {
      context.select(session, result.project_id);
      view.page = "overview";
      view.target_id = null;
    }
    if (result.snapshot && context.accept(context.token(), result.snapshot)) {
      paint();
      subscribe(result.project_id);
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
      if (
        data.project_id === context.token().project_id &&
        data.revision >= (context.read()?.runtime.revision || 0)
      )
        void refresh().catch(report);
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
      if (p.id === token.project_id) clearProject();
      view.page = "library";
      await catalog();
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
      await refresh();
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
      const group = element("section", "", "settings-group");
      group.append(element("h3", "模型"));
      const message = element("p", "", "error settings-error");
      message.setAttribute("role", "status");
      const selects = [];
      for (const [kind, title] of [["text", "文本模型"], ["image", "图片模型"], ["video", "视频模型"]]) {
        const label = element("label", title, "settings-option"), select = element("select");
        select.name = kind;
        select.setAttribute("aria-label", title);
        for (const option of modelOptions[kind]) {
          const item = element("option", option.label);
          item.value = option.value;
          select.append(item);
        }
        select.value = settings[kind].model;
        select.disabled = busy;
        selects.push(select);
        select.onchange = async () => {
          const previous = settings[kind].model;
          settings[kind] = { model: select.value };
          selects.forEach(item => item.disabled = true);
          message.textContent = "";
          try {
            await request("models", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Meiji-Request": "1" },
              body: JSON.stringify({ settings }),
            });
          } catch (error) {
            settings[kind] = { model: previous };
            select.value = previous;
            message.textContent = error.message;
          } finally {
            selects.forEach(item => item.disabled = busy);
          }
        };
        label.append(select);
        group.append(label);
      }
      group.append(message);
      root.append(group);
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
    view.page = "overview";
    paint();
  };
  shell.root.querySelector(".library").onclick = () => {
    view.page = "library";
    context.read() ? paint() : catalog().catch(report);
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
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      stream?.close();
      shell.dispose();
    },
  };
}
