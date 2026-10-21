import { element } from "./panel-dom.js";

export function renderProjectDetails(root, info) {
  const basic = element('section', '', 'overview-card');
  const heading = element('div', '', 'overview-card-title');
  heading.append(element('h3', '基本信息'));
  basic.append(heading);
  basic.dataset.section = 'basic_info';
  for (const [label, value] of [
    ['项目ID', info.id], ['项目名称', info.name],
    ['创作模式', info.creation_mode], ['画幅', info.aspect_ratio],
    ['创作要求', info.creative_requirements || '未填写'],
    ['参考单集时长', `${info.reference_episode_duration_seconds} 秒`],
  ]) {
    const line = element('p', '', 'project-info-line');
    line.append(element('strong', `${label}：`), document.createTextNode(String(value)));
    basic.append(line);
  }
  const original = element('details', '', 'original-script');
  original.append(element('summary', '原始剧本'), element('p', info.original_script || '尚未导入原始剧本', 'prompt full'));
  basic.append(original);
  root.append(basic);
  return basic;
}
