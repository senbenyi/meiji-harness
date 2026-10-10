import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { randomUUID } from "node:crypto";
import { mount } from "../client/workbench.js";
import { snapshotFixture } from "./fixtures/project.js";
test("S7-12 完整面板刷新保留编辑草稿；切换拒绝旧项目；卸载拒绝晚到响应并释放 shell", async () => {
  const dom = new JSDOM("<body></body>", { url: "http://localhost" }),
    saved = {};
  for (const key of [
    "window",
    "document",
    "localStorage",
    "EventSource",
    "fetch",
  ])
    saved[key] = globalThis[key];
  const sid = `session-${randomUUID()}`,
    other = `session-${randomUUID()}`,
    a = snapshotFixture(),
    b = snapshotFixture();
  a.project.名称 = "项目甲";
  b.project.名称 = "项目乙";
  let deferred, resolve, app;
  try {
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      EventSource: class {
        close() {
          this.closed = true;
        }
      },
    });
    dom.window.HTMLDialogElement.prototype.show = function () {
      this.open = true;
    };
    dom.window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new dom.window.Event("close"));
    };
    localStorage.setItem(
      "dsh.sessions.current",
      JSON.stringify({ sessionId: sid }),
    );
    globalThis.fetch = async (url) => {
      if (deferred) await deferred;
      const selected = new URL(url, "http://localhost").searchParams.get(
          "session_id",
        ),
        snapshot = selected === other ? b : a;
      return {
        ok: true,
        json: async () => ({
          project_id: snapshot.project.id,
          snapshot: structuredClone(snapshot),
        }),
      };
    };
    app = mount();
    await app.refresh();
    const content = app.shell.content;
    [
      ...content
        .querySelector('[data-business="project-summary"]')
        .querySelectorAll("button"),
    ]
      .find((n) => n.getAttribute("aria-label") === "人工编辑")
      .click();
    const area = content.querySelector("dialog textarea");
    area.value = "草稿不丢";
    a.runtime.revision++;
    await app.refresh();
    assert.equal(content.querySelector("dialog textarea"), area);
    assert.equal(area.value, "草稿不丢");
    localStorage.setItem(
      "dsh.sessions.current",
      JSON.stringify({ sessionId: other }),
    );
    await new Promise((done, reject) => {
      const timer = setInterval(() => {
          if (app.context.read()?.project.id === b.project.id) {
            clearInterval(timer);
            clearTimeout(timeout);
            done();
          }
        }, 20),
        timeout = setTimeout(() => {
          clearInterval(timer);
          reject(Error("切换超时"));
        }, 1800);
    });
    assert.equal(content.querySelector("dialog"), null);
    assert.equal(app.shell.root.querySelector(".brand").textContent, "项目乙");
    deferred = new Promise((r) => (resolve = r));
    const pending = app.refresh();
    app.dispose();
    resolve();
    await pending;
    assert.equal(document.querySelector("meiji-workbench"), null);
    assert.equal(document.head.querySelector("style"), null);
  } finally {
    app?.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    dom.window.close();
  }
});
