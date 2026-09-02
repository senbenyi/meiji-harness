(() => {
  // src/client/toonflow.module.css
  var toonflow_default = ".tf-root{font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.5;padding:12px 14px;height:100%;overflow-y:auto;color:var(--theme-text,#e0e0e0)}\n.tf-root *{box-sizing:border-box}\n.tf-header{display:flex;align-items:center;gap:8px;margin-bottom:14px;min-height:28px}\n.tf-back{background:none;border:none;color:var(--theme-text,#aaa);cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;display:flex;align-items:center;gap:4px}\n.tf-back:hover{background:var(--theme-input-bg,#80808020)}\n.tf-title{font-size:15px;font-weight:600;flex:1}\n.tf-card{border:1px solid var(--theme-border,#80808040);border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;transition:background .15s}\n.tf-card:hover{background:var(--theme-input-bg,#80808014)}\n.tf-card-head{display:flex;align-items:center;gap:8px}\n.tf-card-title{font-weight:600;font-size:13px;margin-bottom:4px;flex:1}\n.tf-card-meta{font-size:11px;opacity:.6}\n.tf-progress{height:6px;border-radius:3px;background:var(--theme-input-bg,#80808020);margin:6px 0;overflow:hidden}\n.tf-progress-fill{height:100%;border-radius:3px;background:#4a9eff;transition:width .3s}\n.tf-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500;white-space:nowrap}\n.tf-badge-draft{background:#80808025;color:var(--theme-text,#aaa)}\n.tf-badge-ready{background:#1565c020;color:#64b5f6}\n.tf-badge-queued{background:#f57f1720;color:#ffb74d;animation:tf-pulse 1.5s infinite}\n.tf-badge-done{background:#2e7d3220;color:#81c784}\n.tf-badge-failed{background:#c6282820;color:#ef5350}\n@keyframes tf-pulse{0%,100%{opacity:1}50%{opacity:.45}}\n.tf-section{margin-bottom:16px}\n.tf-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}\n.tf-section-title{font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.5px}\n.tf-section-link{font-size:11px;color:#4a9eff;cursor:pointer;background:none;border:none;padding:0}\n.tf-section-link:hover{text-decoration:underline}\n.tf-grid{display:flex;gap:8px;flex-wrap:wrap}\n.tf-thumb{width:72px;border-radius:6px;overflow:hidden;text-align:center;cursor:pointer}\n.tf-thumb-img{width:72px;height:72px;border-radius:6px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--theme-text,#aaa)}\n.tf-thumb-label{font-size:10px;margin-top:3px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.tf-thumb-badge{position:relative}\n.tf-thumb-badge .tf-badge{position:absolute;bottom:2px;right:2px;font-size:9px;padding:0 4px}\n.tf-shot{border:1px solid var(--theme-border,#80808030);border-radius:8px;padding:10px 12px;margin-bottom:8px}\n.tf-shot-head{display:flex;align-items:baseline;gap:6px;margin-bottom:6px}\n.tf-shot-num{font-weight:700;font-size:13px;color:#4a9eff;min-width:24px}\n.tf-shot-desc{font-size:12px;flex:1}\n.tf-shot-media{display:flex;gap:8px;margin-bottom:8px}\n.tf-shot-img{width:120px;height:68px;border-radius:4px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--theme-text,#666)}\n.tf-shot-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px}\n.tf-shot-chars{opacity:.6;flex:1}\n.tf-shot-error{font-size:11px;color:#ef5350;margin-top:4px}\n.tf-btn{font:inherit;cursor:pointer;background:#4a9eff;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;white-space:nowrap;transition:opacity .15s}\n.tf-btn:hover{opacity:.85}\n.tf-btn:disabled{opacity:.4;cursor:not-allowed}\n.tf-btn-ghost{background:transparent;border:1px solid var(--theme-border,#80808050);color:var(--theme-text,#ccc)}\n.tf-btn-danger{background:transparent;border:1px solid #d33;color:#ef5350}\n.tf-btn-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}\n.tf-detail-split{display:flex;gap:14px}\n.tf-detail-left{flex:0 0 45%;display:flex;flex-direction:column;gap:8px}\n.tf-detail-right{flex:1;min-width:0}\n.tf-detail-img{width:100%;aspect-ratio:16/9;border-radius:6px;object-fit:cover;background:var(--theme-input-bg,#80808020);display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--theme-text,#666)}\n.tf-detail-field{margin-bottom:10px}\n.tf-detail-label{font-size:11px;font-weight:600;opacity:.5;text-transform:uppercase;margin-bottom:3px}\n.tf-detail-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px}\n.tf-detail-value{font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}\n.tf-detail-bar{border-top:1px solid var(--theme-border,#80808030);padding-top:10px;margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n.tf-export-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;border-bottom:1px solid var(--theme-border,#80808015)}\n.tf-export-check{width:16px;text-align:center}\n.tf-export-name{flex:1}\n.tf-export-dur{opacity:.6;min-width:30px;text-align:right}\n.tf-export-summary{margin:14px 0;padding:10px;background:var(--theme-input-bg,#80808010);border-radius:6px;font-size:12px;line-height:1.7;white-space:pre-line}\n.tf-empty{text-align:center;padding:40px 20px;opacity:.5;font-size:13px}\n.tf-error{margin-bottom:12px;padding:8px 10px;border:1px solid #c6282860;border-radius:6px;background:#c6282815;color:#ef5350;font-size:12px}\n";

  // src/client/api.js
  var API = "/toonflow/api";
  function createApi(fetchImpl = fetch) {
    async function fetchJson(route, body = {}) {
      const response = await fetchImpl(API + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }
    function mediaUrl(projectId, filePath) {
      if (!projectId || !filePath) return null;
      return `/toonflow/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`;
    }
    return { fetchJson, mediaUrl };
  }

  // src/client/hooks/useProject.js
  function createUseProject(React, api) {
    const { useCallback, useEffect, useState } = React;
    return function useProject(view, projectId) {
      const [projects, setProjects] = useState([]);
      const [plan, setPlan] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [revision, setRevision] = useState(0);
      useEffect(() => {
        if (view !== "list") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        api.fetchJson("/project.list").then((data) => {
          if (!cancelled) setProjects(data.projects || []);
        }).catch((reason) => {
          if (!cancelled) setError(reason.message || String(reason));
        }).finally(() => {
          if (!cancelled) setLoading(false);
        });
        return () => {
          cancelled = true;
        };
      }, [view, revision]);
      useEffect(() => {
        if (view === "list" || !projectId) return;
        let cancelled = false;
        setLoading(true);
        setError("");
        api.fetchJson("/plan.get", { projectId }).then((data) => {
          if (!cancelled) setPlan(data);
        }).catch((reason) => {
          if (!cancelled) setError(reason.message || String(reason));
        }).finally(() => {
          if (!cancelled) setLoading(false);
        });
        return () => {
          cancelled = true;
        };
      }, [view, projectId, revision]);
      const createProject = useCallback(async (input) => {
        setBusy(true);
        setError("");
        try {
          const result = await api.fetchJson("/project.create", input);
          setRevision((value) => value + 1);
          return result;
        } catch (reason) {
          setError(reason.message || String(reason));
          return null;
        } finally {
          setBusy(false);
        }
      }, []);
      const deleteProject = useCallback(async (id) => {
        setBusy(true);
        setError("");
        try {
          await api.fetchJson("/project.delete", { projectId: id });
          setProjects((current) => current.filter((item) => item.id !== id));
          return true;
        } catch (reason) {
          setError(reason.message || String(reason));
          return false;
        } finally {
          setBusy(false);
        }
      }, []);
      const updateShot = useCallback(async (shotId, updates) => {
        setBusy(true);
        setError("");
        try {
          const data = await api.fetchJson("/plan.update_shot", { projectId, shotId, updates });
          setPlan((current) => current ? {
            ...current,
            project: data.project || current.project,
            summary: data.summary || current.summary,
            shots: current.shots.map((shot) => shot.id === shotId ? data.shot : shot)
          } : current);
          return data;
        } catch (reason) {
          setError(reason.message || String(reason));
          return null;
        } finally {
          setBusy(false);
        }
      }, [projectId]);
      return {
        projects,
        plan: plan?.project?.id === projectId ? plan : null,
        loading,
        busy,
        error,
        clearPlan: () => setPlan(null),
        createProject,
        deleteProject,
        updateShot
      };
    };
  }

  // src/client/components/ActionButton.js
  function ActionButton(h, { key, label, disabled, ghost, danger, onClick, title }) {
    const variant = ghost ? " tf-btn-ghost" : danger ? " tf-btn-danger" : "";
    return h("button", {
      className: "tf-btn" + variant,
      key,
      disabled,
      onClick,
      title: title || void 0
    }, label);
  }

  // src/client/components/Breadcrumb.js
  function Breadcrumb(h, { title, onBack, action }) {
    return h(
      "div",
      { className: "tf-header" },
      onBack ? h("button", { className: "tf-back", onClick: onBack }, "\u2190 \u8FD4\u56DE") : null,
      h("span", { className: "tf-title" }, title),
      action || null
    );
  }

  // src/client/components/CharacterCard.js
  function CharacterCard(h, { character, projectId, mediaUrl, generateButton }) {
    return h(
      "div",
      { key: character.id, className: "tf-thumb" },
      character.imagePath ? h("img", { className: "tf-thumb-img", src: mediaUrl(projectId, character.imagePath), alt: character.name }) : h("div", { className: "tf-thumb-img" }, "\u{1F464}"),
      h("div", { className: "tf-thumb-label" }, character.name),
      character.imagePath ? null : generateButton
    );
  }

  // src/client/components/EmptyState.js
  function EmptyState(h, { children }) {
    return h("div", { className: "tf-empty" }, children);
  }

  // src/client/components/ProgressBar.js
  function ProgressBar(h, { done, total }) {
    const percent = total > 0 ? Math.round(done / total * 100) : 0;
    return h(
      "div",
      { className: "tf-progress" },
      h("div", { className: "tf-progress-fill", style: { width: `${percent}%` } })
    );
  }

  // src/client/components/StatusBadge.js
  var STATUS_MAP = {
    draft: { label: "\u8349\u7A3F", cls: "tf-badge-draft" },
    prompt_ready: { label: "\u5C31\u7EEA", cls: "tf-badge-ready" },
    image_queued: { label: "\u9996\u5E27\u751F\u6210\u4E2D\u2026", cls: "tf-badge-queued" },
    image_ready: { label: "\u9996\u5E27\u5B8C\u6210", cls: "tf-badge-done" },
    video_queued: { label: "\u89C6\u9891\u751F\u6210\u4E2D\u2026", cls: "tf-badge-queued" },
    video_ready: { label: "\u5B8C\u6210", cls: "tf-badge-done" },
    failed: { label: "\u5931\u8D25", cls: "tf-badge-failed" }
  };
  function StatusBadge(h, { status }) {
    const value = STATUS_MAP[status] || STATUS_MAP.draft;
    return h("span", { className: `tf-badge ${value.cls}` }, value.label);
  }

  // src/client/views/Dashboard.js
  function createDashboard(React, api) {
    const h = React.createElement;
    return function Dashboard({ projectId, plan, navigate }) {
      const project = plan?.project;
      const characters = plan?.characters || [];
      const scenes = plan?.scenes || [];
      const shots = plan?.shots || [];
      const done = shots.filter((shot) => shot.status === "video_ready").length;
      if (!project) return EmptyState(h, { children: "\u9879\u76EE\u4E0D\u5B58\u5728" });
      return h(
        "div",
        null,
        Breadcrumb(h, { title: project.title, onBack: () => navigate("list") }),
        h(
          "div",
          { className: "tf-section" },
          h(
            "div",
            { className: "tf-section-head" },
            h("span", { className: "tf-section-title" }, `\u89D2\u8272 (${characters.length})`)
          ),
          h("div", { className: "tf-grid" }, characters.map((character) => CharacterCard(h, {
            character,
            projectId,
            mediaUrl: api.mediaUrl,
            generateButton: ActionButton(h, {
              label: "\u751F\u6210\u56FE",
              disabled: true,
              ghost: true,
              title: "\u5373\u5C06\u652F\u6301\uFF1A\u751F\u6210\u89D2\u8272\u53C2\u8003\u56FE"
            })
          })))
        ),
        h(
          "div",
          { className: "tf-section" },
          h(
            "div",
            { className: "tf-section-head" },
            h("span", { className: "tf-section-title" }, `\u573A\u666F (${scenes.length})`)
          ),
          h("div", { className: "tf-grid" }, scenes.map(
            (scene) => h(
              "div",
              { key: scene.id, className: "tf-thumb" },
              scene.imagePath ? h("img", { className: "tf-thumb-img", src: api.mediaUrl(projectId, scene.imagePath), alt: scene.name }) : h("div", { className: "tf-thumb-img" }, "\u{1F3DE}"),
              h("div", { className: "tf-thumb-label" }, scene.name)
            )
          ))
        ),
        h(
          "div",
          { className: "tf-section" },
          h(
            "div",
            { className: "tf-section-head" },
            h("span", { className: "tf-section-title" }, `\u5206\u955C (${shots.length})`),
            h("button", { className: "tf-section-link", onClick: () => navigate("shots", projectId) }, "\u8FDB\u5165\u5206\u955C \u2192")
          ),
          h("div", { className: "tf-grid" }, shots.map(
            (shot) => h(
              "div",
              {
                key: shot.id,
                className: "tf-thumb tf-thumb-badge",
                onClick: () => navigate("shots", projectId)
              },
              shot.imagePath ? h("img", { className: "tf-thumb-img", src: api.mediaUrl(projectId, shot.imagePath), alt: `#${shot.order}` }) : h("div", { className: "tf-thumb-img" }, "\u{1F4F7}"),
              StatusBadge(h, { status: shot.status }),
              h("div", { className: "tf-thumb-label" }, `#${shot.order}`)
            )
          )),
          ProgressBar(h, { done, total: shots.length }),
          h("div", { className: "tf-card-meta" }, `${done}/${shots.length} \u955C\u5934\u5B8C\u6210`)
        ),
        h(
          "div",
          { className: "tf-btn-row" },
          ActionButton(h, { label: "\u25B6 \u6279\u91CF\u751F\u6210", disabled: true, title: "\u5373\u5C06\u652F\u6301\uFF1A\u6279\u91CF\u751F\u6210\u6240\u6709\u5C31\u7EEA\u955C\u5934" }),
          ActionButton(h, { label: "\u{1F4E6} \u5BFC\u51FA MP4", disabled: true, ghost: true, title: "\u5373\u5C06\u652F\u6301\uFF1A\u62FC\u63A5\u6210\u7247" })
        )
      );
    };
  }

  // src/client/views/ExportPanel.js
  function createExportPanel(React) {
    const h = React.createElement;
    return function ExportPanel({ projectId, plan, navigate }) {
      const shots = plan?.shots || [];
      const exportable = shots.filter((shot) => shot.status === "video_ready");
      const duration = exportable.reduce((sum, shot) => sum + shot.durationSec, 0);
      return h(
        "div",
        null,
        Breadcrumb(h, { title: "\u5BFC\u51FA", onBack: () => navigate("dashboard", projectId) }),
        shots.map((shot) => {
          const ready = shot.status === "video_ready";
          return h(
            "div",
            { key: shot.id, className: "tf-export-row" },
            h("span", { className: "tf-export-check" }, ready ? "\u2611" : "\u2610"),
            h("span", { className: "tf-export-name", style: { opacity: ready ? 1 : 0.4 } }, `#${shot.order} ${shot.description}`),
            h("span", { className: "tf-export-dur" }, ready ? `${shot.durationSec}s` : "--"),
            StatusBadge(h, { status: shot.status })
          );
        }),
        h(
          "div",
          { className: "tf-export-summary" },
          `\u53EF\u5BFC\u51FA: ${exportable.length} \u4E2A\u955C\u5934
\u9884\u8BA1\u65F6\u957F: ${duration} \u79D2
\u5206\u8FA8\u7387: 1280\xD7720\u3000\u5E27\u7387: 24fps`
        ),
        h(
          "div",
          { className: "tf-btn-row" },
          ActionButton(h, { label: "\u{1F4E6} \u5BFC\u51FA MP4", disabled: true, title: "\u5373\u5C06\u652F\u6301\uFF1AFFmpeg \u62FC\u63A5\u6210\u7247" })
        )
      );
    };
  }

  // src/client/components/ProjectCard.js
  function timeAgo(timestamp) {
    const value = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
    if (!Number.isFinite(value)) return "\u672A\u77E5\u65F6\u95F4";
    const seconds = Math.max(0, Math.floor((Date.now() - value) / 1e3));
    if (seconds < 60) return "\u521A\u521A";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
    return `${Math.floor(hours / 24)} \u5929\u524D`;
  }
  function ProjectCard(h, { project, busy, progressBar, onSelect, onDelete }) {
    return h(
      "div",
      { key: project.id, className: "tf-card", onClick: onSelect },
      h(
        "div",
        { className: "tf-card-head" },
        h("div", { className: "tf-card-title" }, project.title),
        h("button", {
          className: "tf-btn tf-btn-danger",
          disabled: busy,
          onClick: (event) => {
            event.stopPropagation();
            onDelete();
          }
        }, "\u5220\u9664")
      ),
      progressBar,
      h(
        "div",
        { className: "tf-card-meta" },
        `${project.shotsDone}/${project.shotsTotal} \u5B8C\u6210\u3000${project.characterCount} \u89D2\u8272 \xB7 ${project.sceneCount} \u573A\u666F \xB7 ${timeAgo(project.updatedAt)}`
      )
    );
  }

  // src/client/views/ProjectList.js
  function createProjectList(React) {
    const h = React.createElement;
    return function ProjectList({ projects, loading, busy, onSelect, onCreate, onDelete }) {
      return h(
        "div",
        null,
        h(
          "div",
          { className: "tf-header" },
          h("span", { className: "tf-title" }, "Toonflow"),
          ActionButton(h, { label: "+ \u65B0\u5EFA", disabled: busy, onClick: onCreate })
        ),
        loading ? EmptyState(h, { children: "\u6B63\u5728\u52A0\u8F7D\u2026" }) : projects.length === 0 ? EmptyState(h, { children: "\u6682\u65E0\u9879\u76EE\uFF0C\u70B9\u51FB\u300C+ \u65B0\u5EFA\u300D\u5F00\u59CB" }) : projects.map((project) => ProjectCard(h, {
          project,
          busy,
          progressBar: ProgressBar(h, { done: project.shotsDone, total: project.shotsTotal }),
          onSelect: () => onSelect(project.id),
          onDelete: () => onDelete(project)
        }))
      );
    };
  }

  // src/client/components/ShotRow.js
  function ShotRow(h, {
    shot,
    projectId,
    mediaUrl,
    characterNames,
    sceneName,
    statusBadge,
    action,
    onDetails
  }) {
    return h(
      "div",
      { key: shot.id, className: "tf-shot" },
      h(
        "div",
        { className: "tf-shot-head" },
        h("span", { className: "tf-shot-num" }, `#${shot.order}`),
        h("span", { className: "tf-shot-desc" }, shot.description)
      ),
      h(
        "div",
        { className: "tf-shot-media" },
        shot.imagePath ? h("img", { className: "tf-shot-img", src: mediaUrl(projectId, shot.imagePath), alt: "\u9996\u5E27" }) : h("div", { className: "tf-shot-img" }, "\u{1F4F7}"),
        shot.videoPath ? h("video", { className: "tf-shot-img", src: mediaUrl(projectId, shot.videoPath), controls: true }) : h("div", { className: "tf-shot-img" }, shot.status === "image_ready" ? "\u5F85\u751F\u6210" : "")
      ),
      h(
        "div",
        { className: "tf-shot-footer" },
        h("span", { className: "tf-shot-chars" }, `${characterNames} \xB7 ${sceneName || ""}`),
        statusBadge,
        action,
        h("button", { className: "tf-back", onClick: onDetails, style: { fontSize: 11 } }, "\u8BE6\u60C5 \u2192")
      ),
      shot.lastError ? h("div", { className: "tf-shot-error" }, `\u9519\u8BEF: ${shot.lastError}`) : null
    );
  }

  // src/client/views/ShotBoard.js
  function nameOf(items, id) {
    return (items || []).find((item) => item.id === id)?.name || id || "";
  }
  function createShotBoard(React, api) {
    const h = React.createElement;
    function shotAction(shot) {
      if (shot.status === "draft" || shot.status === "prompt_ready") {
        return ActionButton(h, { label: "\u25B6 \u751F\u6210\u9996\u5E27", disabled: true, title: "\u5373\u5C06\u652F\u6301" });
      }
      if (shot.status === "image_ready") {
        return ActionButton(h, { label: "\u25B6 \u751F\u6210\u89C6\u9891", disabled: true, title: "\u5373\u5C06\u652F\u6301" });
      }
      if (shot.status === "failed" && (shot.retryCount || 0) < 3) {
        return ActionButton(h, { label: `\u{1F504} \u91CD\u8BD5 (${shot.retryCount || 0}/3)`, disabled: true, title: "\u5373\u5C06\u652F\u6301" });
      }
      return null;
    }
    return function ShotBoardView({ projectId, plan, navigate }) {
      const characters = plan?.characters || [];
      const scenes = plan?.scenes || [];
      const shots = plan?.shots || [];
      return h(
        "div",
        null,
        Breadcrumb(h, {
          title: "\u5206\u955C",
          onBack: () => navigate("dashboard", projectId),
          action: ActionButton(h, { label: "\u25B6 \u5168\u90E8\u751F\u6210", disabled: true, title: "\u5373\u5C06\u652F\u6301\uFF1A\u6279\u91CF\u751F\u6210" })
        }),
        shots.length === 0 ? EmptyState(h, { children: "\u6682\u65E0\u5206\u955C" }) : shots.map((shot) => ShotRow(h, {
          shot,
          projectId,
          mediaUrl: api.mediaUrl,
          characterNames: (shot.characterIds || []).map((id) => nameOf(characters, id)).join(", "),
          sceneName: nameOf(scenes, shot.sceneId),
          statusBadge: StatusBadge(h, { status: shot.status }),
          action: shotAction(shot),
          onDetails: () => navigate("shot", projectId, { shotId: shot.id })
        }))
      );
    };
  }

  // src/client/views/ShotDetail.js
  function nameOf2(items, id) {
    return (items || []).find((item) => item.id === id)?.name || id || "";
  }
  function createShotDetail(React, api) {
    const h = React.createElement;
    return function ShotDetail({ projectId, shotId, plan, busy, navigate, onUpdate }) {
      const characters = plan?.characters || [];
      const scenes = plan?.scenes || [];
      const shot = (plan?.shots || []).find((item) => item.id === shotId);
      if (!shot) return EmptyState(h, { children: "\u955C\u5934\u4E0D\u5B58\u5728" });
      function field(label, value, key) {
        return h(
          "div",
          { className: "tf-detail-field" },
          h(
            "div",
            { className: "tf-detail-label-row" },
            h("div", { className: "tf-detail-label" }, label),
            key ? h("button", {
              className: "tf-section-link",
              disabled: busy,
              onClick: () => {
                const next = window.prompt(`\u7F16\u8F91${label}`, value || "");
                if (next !== null && next !== value) void onUpdate(shot.id, { [key]: next });
              }
            }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u7F16\u8F91") : null
          ),
          h("div", { className: "tf-detail-value" }, value || "(\u7A7A)")
        );
      }
      const generationActions = [];
      if (shot.status === "draft" || shot.status === "prompt_ready") {
        generationActions.push(ActionButton(h, { key: "image", label: "\u25B6 \u751F\u6210\u9996\u5E27", disabled: true, title: "\u5373\u5C06\u652F\u6301" }));
      } else if (shot.status === "image_ready") {
        generationActions.push(ActionButton(h, { key: "video", label: "\u25B6 \u751F\u6210\u89C6\u9891", disabled: true, title: "\u5373\u5C06\u652F\u6301" }));
        generationActions.push(ActionButton(h, { key: "image-again", label: "\u{1F504} \u91CD\u65B0\u751F\u6210\u9996\u5E27", disabled: true, ghost: true, title: "\u5373\u5C06\u652F\u6301" }));
      } else if (shot.status === "video_ready") {
        generationActions.push(ActionButton(h, { key: "image-again", label: "\u{1F504} \u91CD\u65B0\u751F\u6210\u9996\u5E27", disabled: true, ghost: true, title: "\u5373\u5C06\u652F\u6301" }));
        generationActions.push(ActionButton(h, { key: "video-again", label: "\u{1F504} \u91CD\u65B0\u751F\u6210\u89C6\u9891", disabled: true, ghost: true, title: "\u5373\u5C06\u652F\u6301" }));
      }
      return h(
        "div",
        null,
        Breadcrumb(h, {
          title: `#${shot.order} ${shot.description}`,
          onBack: () => navigate("shots", projectId)
        }),
        h(
          "div",
          { className: "tf-detail-split" },
          h(
            "div",
            { className: "tf-detail-left" },
            h("div", { className: "tf-detail-label" }, "\u9996\u5E27"),
            shot.imagePath ? h("img", { className: "tf-detail-img", src: api.mediaUrl(projectId, shot.imagePath), alt: "\u9996\u5E27" }) : h("div", { className: "tf-detail-img" }, "\u{1F4F7} \u5F85\u751F\u6210"),
            h("div", { className: "tf-detail-label", style: { marginTop: 8 } }, "\u89C6\u9891"),
            shot.videoPath ? h("video", { className: "tf-detail-img", src: api.mediaUrl(projectId, shot.videoPath), controls: true }) : h("div", { className: "tf-detail-img" }, "\u{1F3AC} \u5F85\u751F\u6210")
          ),
          h(
            "div",
            { className: "tf-detail-right" },
            field("\u63CF\u8FF0", shot.description, "description"),
            field("\u955C\u5934\u8FD0\u52A8", shot.camera, "camera"),
            field("\u89D2\u8272", (shot.characterIds || []).map((id) => nameOf2(characters, id)).join(", ")),
            field("\u573A\u666F", nameOf2(scenes, shot.sceneId)),
            field("\u56FE\u7247\u63D0\u793A\u8BCD", shot.imagePrompt, "imagePrompt"),
            field("\u89C6\u9891\u63D0\u793A\u8BCD", shot.videoPrompt, "videoPrompt"),
            field("\u65F6\u957F", `${shot.durationSec} \u79D2`)
          )
        ),
        h(
          "div",
          { className: "tf-detail-bar" },
          StatusBadge(h, { status: shot.status }),
          shot.lastError ? h("span", { className: "tf-shot-error" }, shot.lastError) : null,
          shot.retryCount > 0 ? h("span", { className: "tf-card-meta" }, `\u91CD\u8BD5 ${shot.retryCount}/3`) : null
        ),
        h("div", { className: "tf-btn-row" }, generationActions)
      );
    };
  }

  // src/client/ToonflowApp.js
  function createToonflowApp(React, api, styles) {
    const { createElement: h, useCallback, useState } = React;
    const useProject = createUseProject(React, api);
    const ProjectList = createProjectList(React);
    const Dashboard = createDashboard(React, api);
    const ShotBoard = createShotBoard(React, api);
    const ShotDetail = createShotDetail(React, api);
    const ExportPanel = createExportPanel(React);
    return function ToonflowApp({ ctx, tab }) {
      const meta = tab?.meta || {};
      const [view, setView] = useState(meta.view || "list");
      const [projectId, setProjectId] = useState(meta.projectId || null);
      const [extra, setExtra] = useState(meta.extra || {});
      const data = useProject(view, projectId);
      const navigate = useCallback((nextView, nextProjectId, nextExtra) => {
        setView(nextView);
        if (nextProjectId !== void 0) {
          if (nextProjectId !== projectId) data.clearPlan();
          setProjectId(nextProjectId);
        }
        const next = nextExtra || {};
        setExtra(next);
        ctx?.get?.("betterSidebar")?.updateTab?.(tab?.id, {
          meta: {
            view: nextView,
            projectId: nextProjectId === void 0 ? projectId : nextProjectId,
            extra: next
          }
        });
      }, [ctx, tab?.id, projectId]);
      async function onCreate() {
        const title = window.prompt("\u9879\u76EE\u540D\u79F0");
        if (!title?.trim()) return;
        const description = window.prompt("\u9879\u76EE\u7B80\u4ECB\uFF08\u53EF\u9009\uFF09");
        await data.createProject({ title: title.trim(), description: description || "" });
      }
      async function onDelete(project) {
        if (!window.confirm(`\u786E\u8BA4\u5220\u9664\u9879\u76EE\u300C${project.title}\u300D\uFF1F\u9879\u76EE\u6587\u4EF6\u548C\u8D44\u4EA7\u4F1A\u4E00\u5E76\u5220\u9664\u3002`)) return;
        await data.deleteProject(project.id);
      }
      let page;
      if (view !== "list" && data.loading && !data.plan) {
        page = h("div", { className: "tf-empty" }, "\u6B63\u5728\u52A0\u8F7D\u2026");
      } else if (view === "dashboard") {
        page = h(Dashboard, { projectId, plan: data.plan, navigate });
      } else if (view === "shots") {
        page = h(ShotBoard, { projectId, plan: data.plan, navigate });
      } else if (view === "shot") {
        page = h(ShotDetail, {
          projectId,
          shotId: extra.shotId,
          plan: data.plan,
          busy: data.busy,
          navigate,
          onUpdate: data.updateShot
        });
      } else if (view === "export") {
        page = h(ExportPanel, { projectId, plan: data.plan, navigate });
      } else {
        page = h(ProjectList, {
          projects: data.projects,
          loading: data.loading,
          busy: data.busy,
          onSelect: (id) => navigate("dashboard", id),
          onCreate,
          onDelete
        });
      }
      return h(
        "div",
        { className: "tf-root" },
        h("style", null, styles),
        data.error ? h("div", { className: "tf-error" }, data.error) : null,
        page
      );
    };
  }

  // src/client/index.js
  window.__ModuleLoader__.load({
    id: "@dsh-external/dsh-toonflow",
    factory: (require2) => {
      console.log("[toonflow] client factory executing");
      const module = { exports: {} };
      const exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      const React = require2("react");
      const h = React.createElement;
      const api = createApi();
      const ToonflowApp = createToonflowApp(React, api, toonflow_default);
      function ToonflowIcon({ size }) {
        return h(
          "svg",
          {
            width: size || 16,
            height: size || 16,
            viewBox: "0 0 16 16",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round"
          },
          h("rect", { x: 2, y: 5, width: 12, height: 9, rx: 1.5 }),
          h("path", { d: "M2 5l3-3h6l3 3" }),
          h("path", { d: "M5.5 2L7 5" }),
          h("path", { d: "M10.5 2L9 5" })
        );
      }
      function firstLeaf(node) {
        return node.kind === "leaf" ? node : firstLeaf(node.children[0]);
      }
      function findTab(node, tabId) {
        if (node.kind === "leaf") return node.tabs.find((tab) => tab.id === tabId);
        for (const child of node.children) {
          const found = findTab(child, tabId);
          if (found) return found;
        }
        return void 0;
      }
      function removeTab(node, tabId) {
        if (node.kind === "leaf") {
          const tabs = node.tabs.filter((tab) => tab.id !== tabId);
          if (tabs.length === node.tabs.length) return node;
          const active = tabs.some((tab) => tab.id === node.active) ? node.active : tabs[tabs.length - 1]?.id || null;
          return { ...node, tabs, active };
        }
        const children = node.children.map((child) => removeTab(child, tabId));
        return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
      }
      function appendTab(node, paneId, tab) {
        if (node.kind === "leaf") {
          return node.id === paneId ? { ...node, tabs: [...node.tabs, tab], active: tab.id } : node;
        }
        const children = node.children.map((child) => appendTab(child, paneId, tab));
        return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
      }
      function apply(ctx) {
        console.log("[toonflow] apply() called");
        ctx.inject(["betterSidebar"], (scope) => {
          scope.effect(() => {
            const sidebar = scope.betterSidebar;
            const disposeTab = sidebar.registerTab({
              id: "toonflow",
              title: "Toonflow",
              icon: (size) => h(ToonflowIcon, { size }),
              order: 60,
              single: true,
              createTab: (state) => {
                const existing = findTab(state.splits, "toonflow") || findTab(state.bottomSplits, "toonflow") || state.floats?.find((item) => item.tab.id === "toonflow")?.tab;
                const tab = existing || { id: "toonflow", type: "toonflow", title: "Toonflow" };
                const cleanSplits = removeTab(state.splits, "toonflow");
                const cleanBottomSplits = removeTab(state.bottomSplits, "toonflow");
                const target = firstLeaf(cleanSplits);
                return {
                  tab,
                  patch: {
                    splits: appendTab(cleanSplits, target.id, tab),
                    bottomSplits: cleanBottomSplits,
                    floats: state.floats?.filter((item) => item.tab.id !== "toonflow") || [],
                    activePane: target.id,
                    panelOpen: true
                  }
                };
              },
              component: (props) => h(ToonflowApp, props)
            });
            console.log("[toonflow] tab registered");
            let opened = false;
            let unsubscribe;
            const openToonflow = () => {
              if (opened || !sidebar.getSnapshot().state) return;
              opened = true;
              sidebar.openTab({ type: "toonflow" });
              unsubscribe?.();
              unsubscribe = void 0;
            };
            unsubscribe = sidebar.subscribeState(openToonflow);
            openToonflow();
            return () => {
              unsubscribe?.();
              disposeTab();
            };
          }, "dsh-toonflow: sidebar tab");
        });
      }
      exports.apply = apply;
      exports.inject = [];
      return module.exports;
    }
  });
})();
