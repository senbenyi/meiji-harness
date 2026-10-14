import { elysiumClient } from '../server/http/elysium/client.js';
import { parseJsonValue } from '../server/prompts/parse-json.js';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  generateGatewayImage,
  submitGatewayVideo,
  retrieveGatewayVideo,
} from "../server/gateway/model-gateway.js";
import { decodeImageData } from "../server/media/decode-image-data.js";
import { saveLastFrame } from "../server/media/extract-video-tail.js";

const connection = {
  baseUrl: "https://gateway.test/v1/",
  apiKey: "test-only-key",
  model: "mock-model",
};
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test("S1-06 文本网关请求分离 system/user，解析内容并拒绝非完整输出", async () => {
  const text = await elysiumClient.complete({
    ...connection, model: "elysium-chat",
    messages: [{ role: "system", content: "系统" }, { role: "user", content: "用户" }],
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-only-key");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.messages, [
        { role: "system", content: "系统" },
        { role: "user", content: "用户" },
      ]);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
      assert.equal(body.presence_penalty, undefined);
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.response_format, undefined);
      assert.equal(body.model, "elysium-chat");
      assert.equal(body.stream, false);
      return json({
        choices: [
          { finish_reason: "stop", message: { content: ' {"正文":"完成"} ', reasoning: "不应作为正文返回" } },
        ],
      });
    },
  });
  assert.deepEqual(parseJsonValue(text), { 正文: "完成" });
  await assert.rejects(
    elysiumClient.complete({
      ...connection, model: "elysium-chat",
      messages: [{ role: "user", content: "测试" }],
      fetchImpl: async () =>
        json({
          choices: [
            { finish_reason: "length", message: { content: "未完成" } },
          ],
        }),
    }),
    /未正常完成/,
  );
});

test("文本网关普通协议：400 不重试，非法 JSON 不因 HTTP200 变成有效结果", async () => {
  let calls = 0;
  await assert.rejects(elysiumClient.complete({ ...connection, model: "elysium-chat", messages: [{ role: "user", content: "返回 JSON" }], fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "字段无效", code: "invalid_request" } }), { status: 400 });
  } }), /字段无效/);
  assert.equal(calls, 1);
  const text = await elysiumClient.complete({ ...connection, model: "elysium-chat", messages: [{ role: "user", content: "返回 JSON" }], fetchImpl: async () => json({ choices: [{ finish_reason: "stop", message: { content: "这不是JSON" } }] }) });
  assert.throws(() => parseJsonValue(text));
});

test("S1-06 图片生成 JSON 与参考图编辑 multipart 保持协议和字节", async () => {
  for (const edit of [false, true]) {
    const result = await generateGatewayImage({
      ...connection,
      prompt: "图片",
      aspectRatio: "1344x768",
      seed: 42,
      references: edit ? [{ mime: "image/png", bytes: png }] : [],
      fetchImpl: async (url, options) => {
        assert.equal(
          url.pathname,
          edit ? "/v1/images/edits" : "/v1/images/generations",
        );
        if (edit) {
          assert.ok(options.body instanceof FormData);
          assert.equal(options.body.get("seed"), null);
          assert.equal(options.body.get("image[]").type, "image/png");
          assert.deepEqual(
            Buffer.from(await options.body.get("image[]").arrayBuffer()),
            png,
          );
        } else {
          const body = JSON.parse(options.body);
          assert.equal(body.seed, 42);
          assert.equal(body.size, "1344x768");
        }
        return json({ data: [{ b64_json: png.toString("base64") }] });
      },
    });
    assert.deepEqual(result, png);
  }
});

test("S1-06 视频提交记录远端 ID，轮询终态后下载；失败终态停止", async () => {
  const remote = await submitGatewayVideo({
    ...connection,
    prompt: "视频",
    duration: 5,
    aspectRatio: "1344x768",
    mode: "reference",
    referenceImages: [`data:image/png;base64,${png.toString("base64")}`],
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/v1/videos");
      const body = JSON.parse(options.body);
      assert.equal(body.seconds, "5");
      assert.equal(body.reference_images.length, 1);
      return json({ id: "remote-1" });
    },
  });
  assert.equal(remote.id, "remote-1");
  let polls = 0;
  let pauses = 0;
  const bytes = await retrieveGatewayVideo({
    ...connection,
    promptId: remote.id,
    maxPolls: 3,
    pause: async () => {
      pauses++;
    },
    fetchImpl: async (url) => {
      if (url.pathname.endsWith("/content"))
        return new Response(Buffer.from("mock-video"));
      polls++;
      return json({ status: polls === 1 ? "processing" : "completed" });
    },
  });
  assert.equal(bytes.toString(), "mock-video");
  assert.equal(polls, 2);
  assert.equal(pauses, 1);
  await assert.rejects(
    retrieveGatewayVideo({
      ...connection,
      promptId: "bad",
      fetchImpl: async () =>
        json({ status: "failed", error: { message: "远端失败" } }),
    }),
    /远端失败/,
  );
});

test("S1-06 图片解码与 JSON 提取拒绝无效类型和语法", () => {
  assert.deepEqual(
    decodeImageData(`data:image/png;base64,${png.toString("base64")}`),
    { mime: "image/png", bytes: png },
  );
  assert.equal(
    decodeImageData(png.toString("base64"), "image/jpg").mime,
    "image/jpeg",
  );
  assert.throws(() => decodeImageData("bad", "image/gif"), /PNG/);
  assert.deepEqual(parseJsonValue('```json\n[{"正文":"内容"}]\n```'), [
    { 正文: "内容" },
  ]);
  assert.throws(() => parseJsonValue('{"正文":'), /JSON/);
});

test("S1-06 真实 FFmpeg 从短视频抽取非空 PNG 尾帧", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meiji-tail-baseline-"));
  try {
    const video = join(dir, "input.mp4"),
      frame = join(dir, "tail.png");
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=32x32:d=0.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        video,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const bytes = await saveLastFrame(video, frame);
    assert.deepEqual(
      bytes.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
