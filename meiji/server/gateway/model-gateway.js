import { recordTransfer } from "./gateway-trace.js";
import { publicHeaders, publicData, redactJson } from "./redact.js";
export { publicData } from "./redact.js";
import { videoSizeOf } from "../../shared/media-parameters.js";
import { gatewayBaseUrl } from "../../models/model-config.js";
import { setTimeout as delay } from "node:timers/promises";
import { decodeImageData } from "../media/decode-image-data.js";

const imageSizes = {
  "1344x768": "1344x768",
  "768x1344": "768x1344",
  "16:9": "1344x768",
  "9:16": "768x1344",
  "1:1": "1024x1024",
  "3:4": "896x1152",
  "4:3": "1152x896",
};

function normalizeImagePixels(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/);
  if (!match)
    throw Object.assign(new Error("画幅需为宽x高像素或已支持的比例"), {
      status: 400,
    });
  let [width, height] = match.slice(1).map(Number);
  if (
    ![width, height].every(
      (side) => Number.isSafeInteger(side) && side > 0 && side % 8 === 0,
    )
  )
    throw Object.assign(new Error("画幅宽高必须为正整数且是 8 的倍数"), {
      status: 400,
    });
  if (Math.max(width, height) > 2048) {
    const scale = 2048 / Math.max(width, height);
    width = Math.floor((width * scale) / 8) * 8;
    height = Math.floor((height * scale) / 8) * 8;
  }
  if (!width || !height)
    throw Object.assign(new Error("画幅归一化后过小"), { status: 400 });
  return `${width}x${height}`;
}

export function gatewayImageSize(aspectRatio) {
  if (!aspectRatio || aspectRatio === "auto") return imageSizes["1344x768"];
  return normalizeImagePixels(imageSizes[aspectRatio] || aspectRatio);
}

export function gatewayVideoSize(aspectRatio) {
  return videoSizeOf(aspectRatio);
}

// 网关 HTTP 请求体上限 64 MiB；超过时本地报错，不发送。
export const requestByteLimit = 64 * 1024 * 1024;

export function dataUrl(bytes, mime) {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

async function readBody(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

function fail(response, data, fallback) {
  const message =
    data?.error?.message ||
    (typeof data === "string"
      ? data.replace(/\s+/g, " ").slice(0, 180)
      : fallback);
  throw Object.assign(new Error(message), {
    status: response.status === 401 ? 401 : 502,
  });
}

const requestTimeoutMs = 15 * 60 * 1000;

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestGateway(options) {
  try {
    return await requestGatewayRaw(options);
  } catch (error) {
    throw error;
  }
}

// body 为 FormData 时按 multipart 发送，logBody 描述其内容；否则按 JSON 发送。
async function requestGatewayRaw({
  baseUrl,
  path,
  method = "GET",
  headers,
  body,
  logBody,
  apiKey,
  fetchImpl,
  signal,
  binary = false,
  binaryLabel = "视频文件",
  redirect,
  fn,
  authenticated = true,
  poll = false,
  finalPoll = false,
}) {
  baseUrl = gatewayBaseUrl(baseUrl);
  if (authenticated) {
    apiKey = String(apiKey || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!apiKey)
      throw Object.assign(new Error("需要网关密钥"), { status: 400 });
    headers = { ...headers, Authorization: `Bearer ${apiKey}` };
  }
  if (method === "POST") {
    const model = body instanceof FormData ? body.get("model") : body?.model;
    if (!String(model || "").trim())
      throw Object.assign(new Error("当前请求需要模型名"), { status: 400 });
  }
  const url = endpoint(baseUrl, path);
  const where = [
    "文件：server/gateway/model-gateway.js",
    `函数：${fn}`,
    `${method} ${url.pathname}${url.search}`,
    `请求地址：${url.href}`,
  ].join("\n");
  const sent = [
    where,
    `请求头：${JSON.stringify(publicHeaders(headers, apiKey))}`,
  ];
  const form = body instanceof FormData;
  if (body !== undefined)
    sent.push(`参数：${publicData(form ? logBody : body, apiKey)}`);
  let response;
  const startedAt = Date.now();
  const record = (data) =>
    recordTransfer({
      fn,
      method,
      path: redactJson(`${url.pathname}${url.search}`, apiKey),
      request: {
        method,
        path: redactJson(`${url.pathname}${url.search}`, apiKey),
        headers: publicHeaders(headers, apiKey),
        body: redactJson(form ? logBody : body, apiKey),
      },
      durationMs: Date.now() - startedAt,
      ...data,
    });
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      signal: requestSignal(signal),
      ...(redirect ? { redirect } : {}),
    });
  } catch (error) {
    await record({
      ok: false,
      status: null,
      error: redactJson(error?.message || "请求没有完成", apiKey),
    });
    throw error;
  }
  let data;
  try {
    if (binary && response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      await record({ ok: true, status: response.status, bytes: bytes.length });
      return bytes;
    }
    data = await readBody(response);
  } catch (error) {
    await record({
      ok: false,
      status: response.status,
      error: redactJson(error?.message || "响应读取失败", apiKey),
    });
    throw error;
  }
  if (
    !poll ||
    finalPoll ||
    !response.ok ||
    ["completed", "failed", "cancelled", "canceled", "expired"].includes(
      data?.status,
    )
  )
    await record({
      ok: response.ok,
      status: response.status,
      body: redactJson(data, apiKey),
    });
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    return { ok: false, response, data, durationMs: Date.now() - startedAt };
  }
  return { ok: true, response, data, durationMs: Date.now() - startedAt };
}

// 上游偶发错误的重试间隔（毫秒）；测试可改为更短或清空。
export const chatRetry = { delays: [1000, 3000] };

export async function completeChat({
  baseUrl,
  apiKey,
  model,
  system,
  prompt,
  fetchImpl = fetch,
  signal,
}) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const payload = {
    model,
    messages,
    stream: false,
    // CloudGPU/Qwen 的部署参数由独立 llm-server 统一补齐。
  };
  // 文本请求可重复提交：网关上游偶发 502/503/504 时自动再试，每次请求各自留痕；图片与视频不在此重试。
  let result;
  for (const [attempt, delay] of [0, ...chatRetry.delays].entries()) {
    if (attempt)
      await new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, delay);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    result = await requestGateway({
      baseUrl,
      path: "chat/completions",
      method: "POST",
      apiKey,
      fetchImpl,
      signal,
      fn: "completeChat",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });
    if (result.ok || ![502, 503, 504].includes(result.response.status)) break;
  }
  if (!result.ok)
    fail(
      result.response,
      result.data,
      `文本生成失败：HTTP ${result.response.status}`,
    );
  const finish = result.data?.choices?.[0]?.finish_reason;
  if (finish && finish !== "stop")
    throw Object.assign(new Error(`模型输出未正常完成：${finish}`), {
      status: 502,
      code: "INCOMPLETE_MODEL_OUTPUT",
    });
  const content = result.data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text)
    throw Object.assign(new Error("模型没有返回文本"), { status: 502 });
  return text;
}

// 下载响应 URL；网关媒体需要原密钥，外部地址不携带密钥。
async function downloadImageBytes({ baseUrl, url, apiKey, fetchImpl, signal }) {
  signal?.throwIfAborted();
  let target;
  try {
    target = endpoint(baseUrl, url);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    )
      throw new Error("invalid URL");
  } catch {
    throw Object.assign(new Error("网关返回的图片 URL 无效"), { status: 502 });
  }
  const sameOrigin = target.origin === new URL(baseUrl).origin;
  const result = await requestGateway({
    baseUrl,
    path: target.href,
    apiKey,
    fetchImpl,
    signal,
    binary: true,
    binaryLabel: "图片文件",
    authenticated: sameOrigin,
    fn: "generateGatewayImage",
    headers: sameOrigin ? { Authorization: `Bearer ${apiKey}` } : {},
    ...(sameOrigin ? { redirect: "error" } : {}),
  });
  signal?.throwIfAborted();
  if (!Buffer.isBuffer(result))
    fail(
      result.response,
      result.data,
      `图片下载失败：HTTP ${result.response.status}`,
    );
  if (!result.length)
    throw Object.assign(new Error("网关返回的图片是空的"), { status: 502 });
  return result;
}

const imageExt = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// 同步生图：无参考图走 images/generations（JSON，可带 seed）；有参考图走 images/edits（multipart，image[] 按顺序上传，不接受 seed）。
// 停止任务会中断请求；网关随之取消这次同步生成。
export async function generateGatewayImage({
  baseUrl,
  apiKey,
  model,
  prompt,
  aspectRatio,
  seed,
  references = [],
  referenceBase64 = [],
  fetchImpl = fetch,
  signal,
  stepTarget,
}) {
  signal?.throwIfAborted();
  const size = gatewayImageSize(aspectRatio);
  const headers = { Authorization: `Bearer ${apiKey}` };
  const images = references.filter((item) => item?.bytes?.length);
  if (
    !Array.isArray(referenceBase64) ||
    referenceBase64.some(
      (value) =>
        typeof value !== "string" ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          value,
        ),
    )
  )
    throw Object.assign(new Error("参考图 Base64 无效"), { status: 400 });
  if (images.length + referenceBase64.length > 10)
    throw Object.assign(new Error("参考图最多 10 张"), { status: 400 });
  images.push(...referenceBase64.map((value) => decodeImageData(value)));
  let request;
  if (images.length) {
    const body = new FormData();
    body.append("model", model || "");
    body.append("prompt", prompt);
    body.append("size", size);
    images.forEach((item, index) => {
      if (!imageExt[item.mime])
        throw Object.assign(new Error("参考图需为 PNG、JPG 或 WebP"), {
          status: 400,
        });
      body.append(
        "image[]",
        new Blob([item.bytes], { type: item.mime }),
        `reference-${index + 1}.${imageExt[item.mime]}`,
      );
    });
    const logBody = {
      model: model,
      prompt,
      size,
      "image[]": images.map(
        (item, index) =>
          `reference-${index + 1}.${imageExt[item.mime]}（${item.mime}，${item.bytes.length} 字节）`,
      ),
    };
    request = { path: "images/edits", headers, body, logBody };
  } else {
    const body = {
      model: model,
      prompt,
      size,
      ...(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
        ? { seed }
        : {}),
    };
    request = {
      path: "images/generations",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    };
  }
  const result = await requestGateway({
    baseUrl,
    method: "POST",
    apiKey,
    fetchImpl,
    signal,
    fn: "generateGatewayImage",
    ...request,
  });
  if (!result.ok)
    fail(
      result.response,
      result.data,
      `图片生成失败：HTTP ${result.response.status}`,
    );
  signal?.throwIfAborted();
  const image = result.data?.data?.[0];
  if (!(typeof image?.url === "string" && image.url.trim())) {
    if (typeof image?.b64_json !== "string" || !image.b64_json)
      throw Object.assign(new Error("网关未返回图片"), { status: 502 });
    if (!Buffer.from(image.b64_json, "base64").length)
      throw Object.assign(new Error("网关返回的图片是空的"), { status: 502 });
  }
  let encoded = image?.b64_json;
  if (typeof image?.url === "string" && image.url.trim()) {
    const downloaded = await downloadImageBytes({
      baseUrl,
      url: image.url.trim(),
      apiKey,
      fetchImpl,
      signal,
    });
    signal?.throwIfAborted();
    encoded = downloaded.toString("base64");
  }
  if (typeof encoded !== "string" || !encoded)
    throw Object.assign(new Error("网关未返回图片"), { status: 502 });
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length)
    throw Object.assign(new Error("网关返回的图片是空的"), { status: 502 });
  return bytes;
}

// 网关不提供取消接口：停止只结束本地等待，如实说明远端任务可能仍在运行。
function notCancelled(promptId) {
  return Object.assign(
    new Error(
      `任务已停止；网关不提供取消接口，远端视频任务（${promptId}）可能仍在运行`,
    ),
    { code: "REMOTE_NOT_CANCELLED" },
  );
}

// 参考素材为 base64 data URL（reference_images 按 <Picture N> 顺序），首帧可为 data URL 或裸 base64。
export async function submitGatewayVideo({
  baseUrl,
  apiKey,
  model,
  prompt,
  duration,
  aspectRatio,
  mode,
  inputReference,
  referenceImages,
  fetchImpl = fetch,
  signal,
}) {
  signal?.throwIfAborted();
  const seconds = String(Math.round(Number(duration) || 5));
  const body = {
    model: model,
    prompt,
    seconds,
    size: gatewayVideoSize(aspectRatio),
  };
  const images = (referenceImages || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (images.length > 9)
    throw Object.assign(new Error("参考图最多 9 张"), { status: 409 });
  if (
    images.some((item) => !/^data:image\/(?:png|jpeg|webp);base64,/.test(item))
  )
    throw Object.assign(
      new Error("参考图需为 PNG、JPG 或 WebP 的 base64 data URL"),
      { status: 409 },
    );
  const kind = ["text", "first_frame", "reference"].includes(mode)
    ? mode
    : images.length
      ? "reference"
      : inputReference
        ? "first_frame"
        : "text";
  if (kind === "reference") body.reference_images = images;
  else if (kind === "first_frame" && inputReference)
    body.input_reference = inputReference;
  const size = Buffer.byteLength(JSON.stringify(body));
  if (size > requestByteLimit)
    throw Object.assign(
      new Error(
        `视频请求 ${(size / 1024 / 1024).toFixed(1)} MiB，超过网关 64 MiB 上限，请减少或压缩参考图`,
      ),
      { status: 413 },
    );
  // 提交期间保留连接取得任务 ID，停止时才能如实记录远端任务。
  const result = await requestGateway({
    baseUrl,
    path: "videos",
    method: "POST",
    apiKey,
    fetchImpl,
    signal: AbortSignal.timeout(requestTimeoutMs),
    fn: "submitGatewayVideo",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!result.ok)
    fail(
      result.response,
      result.data,
      `视频提交失败：HTTP ${result.response.status}`,
    );
  if (!result.data?.id)
    throw Object.assign(new Error("网关未返回视频任务"), { status: 502 });
  if (signal?.aborted) throw notCancelled(result.data.id);
  return { id: result.data.id, seconds, size: body.size };
}

const wait = (ms, signal) => delay(ms, undefined, { signal });

export async function retrieveGatewayVideo({
  baseUrl,
  apiKey,
  promptId,
  fetchImpl = fetch,
  pause = wait,
  signal,
  maxPolls = 360,
}) {
  const fn = "retrieveGatewayVideo";
  const deadline = AbortSignal.timeout(30 * 60 * 1000);
  const pollingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const path = `videos/${encodeURIComponent(promptId)}`;
  const headers = { Authorization: `Bearer ${apiKey}` };
  let terminal = false;
  let lastPoll = null;
  try {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      pollingSignal.throwIfAborted();
      lastPoll = null;
      const result = await requestGateway({
        baseUrl,
        path,
        apiKey,
        fetchImpl,
        signal: pollingSignal,
        fn,
        headers,
        poll: true,
        finalPoll: attempt + 1 === maxPolls,
      });
      if (!result.ok)
        fail(
          result.response,
          result.data,
          `视频查询失败：HTTP ${result.response.status}`,
        );
      const data = result.data;
      if (
        attempt + 1 < maxPolls &&
        !["completed", "failed", "cancelled", "canceled", "expired"].includes(
          data.status,
        )
      )
        lastPoll = {
          fn,
          method: "GET",
          path,
          status: result.response.status,
          ok: true,
          body: redactJson(data, apiKey),
          durationMs: result.durationMs,
        };
      if (
        ["failed", "cancelled", "canceled", "expired"].includes(data.status)
      ) {
        terminal = true;
        throw Object.assign(
          new Error(`视频生成失败：${data.error?.message || data.status}`),
          { status: 502, code: "VIDEO_TASK_TERMINAL" },
        );
      }
      if (data.status === "completed") {
        terminal = true;
        pollingSignal.throwIfAborted();
        const bytes = await requestGateway({
          baseUrl,
          path: `${path}/content`,
          apiKey,
          fetchImpl,
          signal: pollingSignal,
          binary: true,
          fn,
          headers,
        });
        pollingSignal.throwIfAborted();
        if (Buffer.isBuffer(bytes)) return bytes;
        fail(
          bytes.response,
          bytes.data,
          `视频下载失败：HTTP ${bytes.response.status}`,
        );
      }
      if (attempt + 1 < maxPolls) await pause(5000, pollingSignal);
    }
    throw Object.assign(
      new Error(
        `视频查询超时，已停止等待，不会自动重新提交；网关不提供取消接口，远端任务可能仍在运行（${promptId}）`,
      ),
      { status: 504 },
    );
  } catch (error) {
    if (lastPoll)
      await recordTransfer({
        ...lastPoll,
        error: redactJson(error.message, apiKey),
      });
    if (!terminal && signal?.aborted && signal.reason?.name !== "TimeoutError")
      throw notCancelled(promptId);
    if (!terminal && deadline.aborted)
      throw Object.assign(
        new Error(
          `视频查询超时，已停止等待，不会自动重新提交；网关不提供取消接口，远端任务可能仍在运行（${promptId}）`,
        ),
        { status: 504 },
      );
    throw error;
  }
}

export function parseJsonValue(text) {
  const source = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  const body = (fenced ? fenced[1] : source).trim();
  const start = ["[", "{"].reduce((found, mark) => {
    const index = body.indexOf(mark);
    return index >= 0 && index < found ? index : found;
  }, Infinity);
  if (!Number.isFinite(start))
    throw Object.assign(new Error("模型没有返回 JSON"), {
      status: 502,
      code: "INVALID_MODEL_JSON",
    });
  try {
    return JSON.parse(body.slice(start));
  } catch (error) {
    const location = /position \d+(?: \(line \d+ column \d+\))?/.exec(
      error.message,
    )?.[0];
    throw Object.assign(
      new Error(
        `JSON 无法解析${location ? `（${location}）` : ""}：请检查对象括号、逗号及字符串转义，返回完整合法 JSON`,
      ),
      { status: 502, code: "INVALID_MODEL_JSON" },
    );
  }
}
