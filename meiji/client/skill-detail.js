import { element, tabs } from './panel-dom.js';

function copyButton(title, section) {
  const copy = element('button', '复制', 'meiji-log-copy');
  copy.type = 'button';
  copy.setAttribute('aria-label', `复制${title}`);
  copy.onclick = async event => {
    event.stopPropagation();
    copy.disabled = true;
    try {
      const text = [...section.querySelectorAll('h3, h4, pre.skill-text')].map(node => node.textContent).join('\n\n');
      await navigator.clipboard.writeText(text);
      copy.textContent = '已复制';
    } catch {
      copy.textContent = '复制失败，重试';
    } finally {
      copy.disabled = false;
    }
  };
  return copy;
}

function ruleInput(label, value, onCommit) {
  const wrap = element('label', '', 'skill-rule-input');
  wrap.append(element('span', label));
  const area = element('textarea');
  area.value = value;
  area.setAttribute('aria-label', label);
  let saved = value;
  area.oninput = () => onCommit?.(area.value, false);
  area.onblur = () => {
    if (!onCommit || area.value === saved) return;
    Promise.resolve(onCommit(area.value, true)).then(() => { saved = area.value; }).catch(() => { area.value = saved; });
  };
  wrap.append(area);
  return wrap;
}

export function renderSkillDetail({ label, supplement, opinion }, { load, back, onOpinion, onSupplement }) {
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
        ['generate', '生成规则', rules.generate || '本节点没有生成规则。'],
        ['revise', '修订规则', rules.revise || '本节点没有修订规则。'],
        ['review', '审核规则', rules.review || '本节点没有 AI 审核。'],
      ]) {
        const section = element('section', '', 'settings-group skill-base');
        section.dataset.rules = key;
        section.hidden = key !== 'generate';
        const head = element('div', '', 'skill-rule-head');
        head.append(element('h3', title), copyButton(title, section));
        section.append(head, element('pre', content, 'skill-text'));
        if (key === 'generate' && supplement) section.append(ruleInput(supplement.label, supplement.value, onSupplement));
        if (key === 'generate' && !supplement) section.append(element('p', '本节点不使用补充需求。', 'skill-rule-note'));
        if (key === 'revise' && rules.revise) section.append(ruleInput('本次修改意见', opinion || '', (value, commit) => onOpinion?.(value, commit)));
        if (key === 'review') section.append(element('p', '审核沿用生成标签中的补充需求，不另收输入。', 'skill-rule-note'));
        sections.set(key, section);
      }
      const nav = tabs('规则', [['generate', '生成规则'], ['revise', '修订规则'], ['review', '审核规则']], 'generate', key => {
        for (const [id, section] of sections) section.hidden = id !== key;
      });
      page.replaceChildren(header(), nav, ...sections.values());
    }).catch(error => page.replaceChildren(header(), element('p', error.message, 'error'), button('重新加载', loadPage)));
  };
  loadPage();
  return page;
}
