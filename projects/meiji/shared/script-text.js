// 会话导入有时把 {title, content} 整份 JSON 存成剧本。正文在 content 里，外壳不能参与切段。
export function scriptText(body) {
  const raw = String(body ?? '');
  const text = raw.trim();
  if (!text.startsWith('{')) return raw;
  try {
    const value = JSON.parse(text);
    if (value && typeof value.content === 'string' && value.content.trim()) return value.content;
  } catch { /* 普通剧本原文 */ }
  return raw;
}

// 所有后续制作统一读取当前优化稿，尚未优化时读取原稿。
export function currentScript(project) {
  return project.script_revision.body.trim() ? project.script_revision.body : project.basic_info.original_script;
}
