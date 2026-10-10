import { projectDialog } from "./project-forms.js";
import { renderLibrary as libraryView } from "./library-ui.js";
import { fieldsForm } from "./content-forms.js";
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
    paintVersion = 0,
    retainedDrafts = new Map();
  const paint = () => {
    paintVersion++;
    const snapshot = context.read();
    if (!snapshot) return catalog();
    shell.root.querySelector(".brand").textContent = snapshot.project.名称;
    shell.root.querySelector(".language").textContent =
      snapshot.project.输出语言 === "en" ? "English" : "中文";
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
    retainedDrafts.clear();
    for (const form of drafts) retainedDrafts.set(form.dataset.draftKey, form);
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
    retainedDrafts.clear();
    shell.root.querySelector(".brand").textContent = emptyBrand;
    shell.root.querySelector(".language").textContent = "中文";
  };
  const refresh = async () => {
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
      group.append(element("h3", "网关与模型"));
      const values = {
        网关地址: settings.baseUrl,
        网关密钥: "",
        聊天模型: settings.chat.model,
        剧情模型: settings.story.model,
        图片模型: settings.image.model,
        视频模型: settings.video.model,
      };
      const form = element("form", "", "image-text-editor"),
        fields = fieldsForm(values, { disabled: busy });
      form.dataset.draftKey = "models";
      form.oninput = () => (form.dataset.dirty = "true");
      fields.box.querySelector('[name="网关密钥"]').type = "password";
      for (const grid of fields.box.querySelectorAll(".image-text-grid"))
        grid.style.gridTemplateColumns = "minmax(0,1fr)";
      fields.box.style.gridTemplateColumns = "minmax(0,1fr)";
      for (const label of fields.box.querySelectorAll("label"))
        label.style.gridTemplateColumns = "minmax(0,1fr)";
      const message = element("p", "", "error"),
        save = element("button", "保存", "primary");
      save.type = "submit";
      save.disabled = busy;
      form.append(
        fields.box,
        element("p", "密钥留空保留原值", "meta"),
        message,
        save,
      );
      form.onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          const v = fields.read(),
            settings = {
              baseUrl: v.网关地址,
              chat: { model: v.聊天模型 },
              story: { model: v.剧情模型 },
              image: { model: v.图片模型 },
              video: { model: v.视频模型 },
            };
          if (v.网关密钥) settings.apiKey = v.网关密钥;
          await request("models", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Meiji-Request": "1",
            },
            body: JSON.stringify({ settings }),
          });
          form.dataset.dirty = "false";
          message.textContent = "已保存";
        } catch (e) {
          message.textContent = e.message;
        } finally {
          save.disabled = busy;
        }
      };
      group.append(retainedDrafts.get("models") || form);
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
      stream?.close();
      shell.dispose();
    },
  };
}
