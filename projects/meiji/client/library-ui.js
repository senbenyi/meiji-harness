import { element, tabs } from "./panel-dom.js";
import { request } from "./task-client.js";
const categories = [
  ["characters", "人物"],
  ["costumes", "服装"],
  ["audio", "声音"],
  ["video", "视频"],
  ["scripts", "剧本"],
];
export async function renderLibrary(
  root,
  { state, valid, paint, report, open, remove, create, back, busy = false },
) {
  const view = element("section", "", "library-view");
  root.replaceChildren(view);
  const main = state.library_tab || "projects";
  view.append(
    element("h2", "片库"),
    tabs(
      "片库",
      [
        ["projects", "短剧"],
        ["assets", "素材"],
      ],
      main,
      (id) => {
        state.library_tab = id;
        paint();
      },
    ),
  );
  if (back) {
    const b = element("button", "← 返回项目", "back");
    b.onclick = back;
    view.prepend(b);
  }
  if (main === "projects") {
    const { projects } = await request("projects");
    if (!valid()) return;
    const status = state.library_status || "active";
    view.append(
      tabs(
        "短剧状态",
        [
          ["active", "进行中"],
          ["completed", "已完成"],
        ],
        status,
        (id) => {
          state.library_status = id;
          paint();
        },
      ),
    );
    const list = element("div", "", "project-list");
    view.append(list);
    for (const p of projects) {
      const completed = p.completed === true;
      if ((status === "completed") !== completed) continue;
      const card = element("article", "", "card"),
        pick = element("button", p.name);
      pick.disabled = !!p.unsupported;
      pick.onclick = () => open(p);
      const del = element("button", "删除项目", "delete-content");
      del.onclick = () => {
        if (window.confirm("删除这部短剧及其资料？")) remove(p);
      };
      card.append(
        pick,
        element("p", `${p.aspect_ratio || ""} · ${p.episode_count || 0} 集`, "meta"),
        del,
      );
      if (p.unsupported)
        card.append(
          element("p", "旧格式项目不受支持，可删除后重新创建", "notice"),
        );
      list.append(card);
    }
    const plus = element("button", "＋", "create-large");
    plus.setAttribute("aria-label", "创建项目");
    plus.onclick = create;
    const empty = element("div", "", "create-empty");
    empty.append(plus);
    list.append(empty);
    return;
  }
  const category = state.library_category || "characters";
  view.append(
    tabs("素材分类", categories, category, (id) => {
      state.library_category = id;
      paint();
    }),
  );
  const toolbar = element("div", "", "asset-toolbar"),
    imp = element("button", "导入素材", "primary"),
    file = element("input"),
    message = element("p", "", "error");
  file.type = "file";
  file.multiple = true;
  file.hidden = true;
  file.accept =
    category === "scripts"
      ? ".txt,.md"
      : category === "audio"
        ? "audio/*"
        : category === "video"
          ? "video/*"
          : "image/png,image/jpeg,image/webp";
  file.setAttribute("aria-label", "选择导入素材");
  imp.disabled = busy;
  imp.onclick = () => file.click();
  toolbar.append(imp, file);
  view.append(
    toolbar,
    element("p", "项目资料存在引用时不可删除", "notice"),
    message,
  );
  const list = element("div", "", "asset-list");
  view.append(list);
  const post = (body) =>
    request("library", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Meiji-Request": "1" },
      body: JSON.stringify(body),
    });
  file.onchange = async () => {
    imp.disabled = true;
    try {
      for (const f of file.files || []) {
        if (f.size > 11 * 1024 * 1024) throw Error("素材请小于11MB");
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(Error("文件读取失败"));
          reader.readAsDataURL(f);
        });
        if (!valid()) return;
        await post({ type: "import", name: f.name, category, data });
      }
      if (valid()) paint();
    } catch (e) {
      message.textContent = e.message;
    } finally {
      imp.disabled = busy;
    }
  };
  const { assets } = await request("library");
  if (!valid()) return;
  for (const asset of assets.filter((a) => a.category === category)) {
    const card = element("article", "", "asset-card"),
      href = "/api/meiji/library/" + encodeURIComponent(asset.id);
    if (/^(image|audio|video)\//.test(asset.mime)) {
      const kind = asset.mime.split("/")[0],
        preview = element(kind === "image" ? "img" : kind);
      preview.src = href;
      preview.controls = true;
      preview.loading = "lazy";
      preview.alt = asset.originalName;
      card.append(preview);
    } else {
      const details = element("details"),
        summary = element("summary", "查看剧本"),
        text = element("pre", "", "guidance-text");
      details.append(summary, text);
      details.ontoggle = async () => {
        if (!details.open || text.textContent) return;
        try {
          const r = await fetch(href);
          if (!r.ok) throw Error("读取失败");
          text.textContent = await r.text();
        } catch (e) {
          text.textContent = e.message;
        }
      };
      card.append(details);
    }
    card.append(
      element("strong", asset.originalName),
      element("p", `${asset.createdAt || ""}`, "meta"),
    );
    const actions = element("div", "", "asset-actions"),
      download = element("a", "下载原文件"),
      del = element("button", "删除素材");
    download.href = href;
    download.download = asset.originalName;
    del.disabled = busy;
    del.onclick = async () => {
      try {
        await post({ type: "delete", id: asset.id });
        if (valid()) paint();
      } catch (e) {
        message.textContent = e.message;
        report(e.message);
      }
    };
    actions.append(download, del);
    card.append(actions);
    list.append(card);
  }
  if (!list.children.length) list.append(element("p", "暂无素材", "empty"));
}
