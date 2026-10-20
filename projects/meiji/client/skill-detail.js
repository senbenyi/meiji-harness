import { element, tabs } from './panel-dom.js';

function copyButton(title, section) {
  const copy = element('button', '复制', 'meiji-log-copy');
  copy.type = 'button';
  copy.setAttribute('aria-label', `复制${title}`);
  copy.onclick = async event => {
    event.stopPropagation();
    copy.disabled = true;
    try {
      const text = [...section.querySelectorAll('pre.skill-text, textarea')]
        .map(node => node.tagName === 'TEXTAREA' ? node.value : node.textContent).join('\n\n');
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

function ruleInput(label, value, onCommit, showLabel = true) {
  const wrap = element('label', '', 'skill-rule-input');
  if (showLabel) wrap.append(element('span', label));
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

function ruleCard(title, className) {
  const card = element('section', '', `settings-group skill-rule-card ${className}`);
  const head = element('div', '', 'skill-rule-head');
  head.append(element('h3', title), copyButton(title, card));
  card.append(head);
  return card;
}

export function renderSkillDetail({ label, rules: savedRules, opinion }, { load, back, onOpinion, onRule }) {
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
      for (const [key, content] of [
        ['generate', rules.generate || '本节点没有生成规则。'],
        ['revise', rules.revise || '本节点没有修订规则。'],
        ['review', rules.review || '本节点没有 AI 审核。'],
      ]) {
        const section = element('section', '', 'skill-rule-tab');
        section.dataset.rules = key;
        section.hidden = key !== 'generate';
        const supplement = ruleCard('补充规则', 'skill-supplement-card');
        supplement.append(ruleInput('补充规则', savedRules?.[key]?.supplement || '',
          (value, commit) => onRule?.(key, 'supplement', value, commit), false));
        section.append(supplement);
        const base = ruleCard('基础规则', 'skill-base');
        const text = [savedRules?.[key]?.base, content].filter(Boolean).join('\n\n');
        base.append(element('pre', text, 'skill-text'));
        section.append(base);
        if (key === 'revise' && rules.revise) section.append(ruleInput('本次修改意见', opinion || '', (value, commit) => onOpinion?.(value, commit)));
        section.append(element('p', '基础规则由代码维护；各动作的补充规则独立使用，冲突请调整补充规则。', 'skill-rule-note'));
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
