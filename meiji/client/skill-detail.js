import { element, tabs } from './panel-dom.js';

function copyButton(title, section) {
  const copy = element('button', '复制', 'meiji-log-copy');
  copy.type = 'button';
  copy.setAttribute('aria-label', `复制${title}`);
  copy.onclick = async event => {
    event.stopPropagation();
    copy.disabled = true;
    try {
      const text = [...section.querySelectorAll('h3, h4, pre.skill-text:not(.skill-contract), textarea[aria-label="基础规则"], textarea[aria-label="补充规则"]')].map(node => node.tagName === 'TEXTAREA' ? node.value : node.textContent).join('\n\n');
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

export function renderSkillDetail({ label, rules: savedRules, opinion }, { load, back, onOpinion, onRule, onSync }) {
  const page = element('section', '', 'settings-page skill-detail skill-detail-page');
  const button = (title, action) => {
    const b = element('button', title);
    b.type = 'button'; b.onclick = action;
    return b;
  };
  const header = () => {
    const head = element('header', '', 'skill-page-head');
    head.append(button('← 返回', back), element('h2', `${label} · 规则`), button('同步基础规则', onSync));
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
        section.append(head);
        if (savedRules) {
          section.append(ruleInput('基础规则', savedRules[key].base, (value, commit) => onRule?.(key, 'base', value, commit)),
            ruleInput('补充规则', savedRules[key].supplement, (value, commit) => onRule?.(key, 'supplement', value, commit)));
        }
        section.append(element('pre', content, 'skill-text skill-contract'));
        if (key === 'revise' && rules.revise) section.append(ruleInput('本次修改意见', opinion || '', (value, commit) => onOpinion?.(value, commit)));
        section.append(element('p', '各动作的补充规则独立使用；冲突请人工修改。输出格式和程序校验由节点契约约束。', 'skill-rule-note'));
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
