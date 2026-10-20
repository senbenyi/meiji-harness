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
