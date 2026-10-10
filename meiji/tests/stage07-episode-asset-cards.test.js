import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderTaskPanel } from "../client/task-panel.js";
import { blankCharacter } from "../client/resource-ui.js";
import { snapshotFixture } from "./fixtures/project.js";

test("本集资产角色复用项目角色卡片、显示图片或首字占位并可打开角色资料", () => {
  const dom = new JSDOM("<main></main>", { url: "http://localhost" }),
    oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(),
      episode = snapshot.project.剧集[0],
      pictured = {
        ...blankCharacter(),
        名称: "周巡检",
        身份: "军中巡检",
        图片: { 状态: "generated", 原因: "", 地址: "/portrait.png" },
        参考图: { 状态: "empty", 原因: "", 地址: "" },
        id: "c_portrait",
      },
      missing = {
        ...blankCharacter(),
        编号: "C02",
        名称: "潘金莲",
        身份: "武大家妻",
        图片: { 状态: "empty", 原因: "", 地址: "" },
        参考图: { 状态: "empty", 原因: "", 地址: "" },
        id: "c_missing",
      },
      view = { page: "episode", episode_id: episode.id, tab: "assets" },
      root = document.querySelector("main"),
      context = {
        session_id: "test-session",
        view,
        refresh: async () => {},
        onError: () => {},
        paint: () => renderTaskPanel(root, snapshot, context),
      };
    snapshot.project.角色库.角色 = [pictured, missing];
    episode.本集资产.角色 = [
      { 角色id: pictured.id, 出镜: "出镜" },
      { 角色id: missing.id, 出镜: "仅声音" },
    ];

    context.paint();

    const cards = root.querySelectorAll(".episode-assets-characters .library-card");
    assert.equal(cards.length, 2);
    assert.equal(cards[0].querySelector("img").alt, "周巡检");
    assert.match(cards[0].querySelector("img").src, /portrait\.png\?session_id=test-session/);
    assert.equal(cards[0].querySelector(".library-card-info strong").textContent, "周巡检");
    assert.equal(cards[0].querySelector(".meta").textContent, "C01 · 军中巡检");
    assert.equal(cards[0].querySelector(".episode-character-presence").textContent, "出镜");
    assert.equal(cards[1].querySelector(".library-card-avatar").tagName, "DIV");
    assert.equal(cards[1].querySelector(".library-card-avatar").textContent, "潘");
    assert.equal(cards[1].querySelector(".episode-character-presence").textContent, "仅声音");
    cards[0].click();
    assert.equal(view.page, "character");
    assert.equal(view.character_id, pictured.id);
  } finally {
    globalThis.document = oldDocument;
    dom.window.close();
  }
});
