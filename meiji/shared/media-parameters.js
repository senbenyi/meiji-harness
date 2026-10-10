export function videoSizeOf(value = "1344x768") {
  const sizes = {
    "1344x768": "1024x576",
    "768x1344": "576x1024",
    "16:9": "1024x576",
    "9:16": "576x1024",
  };
  if (!sizes[value])
    throw Object.assign(new Error("视频画幅需为 1344x768 或 768x1344"), {
      status: 400,
    });
  return sizes[value];
}
