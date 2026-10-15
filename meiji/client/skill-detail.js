import { element, tabs } from './panel-dom.js';

export function renderSkillDetail({ label, supplement, opinion }, { load, back }) {
  const page = element('section', '', 'settings-page skill-detail skill-detail-page');
  const button = (title, action) => {
    const b = element('button', title);
    b.type = 'button'; b.onclick = action;
    return b;
  };
  const header = () => {
    const head = element('header', '', 'skill-page-head');
    head.append(button('← 返回', back), element('h2', `${label} · 规则`));
    return head;
  };
  const loadPage = () => {
    page.replaceChildren(header(), element('p', '正在读取…', 'skill-status'));
    Promise.resolve().then(load).then(rules => {
      const sections = new Map();
      for (const [key, title, content] of [
        ['generate', '生成规则', rules.generate],
        ['review', '审核规则', rules.review || '本节点没有 AI 审核。'],
        ['supplement', '补充规则', supplement || '当前没有补充规则。'],
      ]) {
        const section = element('section', '', 'settings-group skill-base');
        section.dataset.rules = key;
        section.hidden = key !== 'generate';
        section.append(element('h3', title), element('pre', content, 'skill-text'));
        if (key === 'generate' && rules.revise)
          section.append(element('h4', '修订规则'), element('pre', rules.revise, 'skill-text'));
        if (key === 'supplement' && opinion)
          section.append(element('h4', '本次执行意见（尚未提交）'), element('pre', opinion, 'skill-text'));
        sections.set(key, section);
      }
      const nav = tabs('规则', [['generate', '生成规则'], ['review', '审核规则'], ['supplement', '补充规则']], 'generate', key => {
        for (const [id, section] of sections) section.hidden = id !== key;
      });
      page.replaceChildren(header(), nav, ...sections.values());
    }).catch(error => page.replaceChildren(header(), element('p', error.message, 'error'), button('重新加载', loadPage)));
  };
  loadPage();
  return page;
}
