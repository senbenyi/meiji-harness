import { element, showPanelDialog } from '../../../client/ui/panel-dom.js';

// 浏览器仅维护展示字段，不读取设计文档或导入服务端 Schema。
export function emptyAdaptationPlan() {
  return { audience: '', style: '', story_direction: { main_plot: '', must_preserve: [], constraints: [] }, character_plans: [], group_plans: [], scene_plans: [] };
}

export function renderAdaptationPlan(root, { value, onChange } = {}) {
  const plan = value || emptyAdaptationPlan();
  let dialog, saving = false;
  const button = (label, action) => {
    const node = element('button', label);
    node.type = 'button'; node.onclick = action;
    return node;
  };
  const close = () => { if (dialog?.open) dialog.close(); dialog?.remove(); dialog = null; };
  const apply = async (change) => {
    if (saving) return;
    const next = structuredClone(plan);
    change(next); saving = true;
    try { await onChange?.(next); close(); }
    finally { saving = false; }
  };
  const open = (title, fields, change) => {
    close();
    dialog = element('dialog', '', 'production-editor adaptation-plan-editor');
    const owned = dialog, form = element('form', '', 'production-field-form'), inputs = {}, error = element('p', '', 'error');
    dialog.setAttribute('aria-label', title);
    dialog.addEventListener('close', () => { owned.remove(); if (dialog === owned) dialog = null; }, { once: true });
    form.append(element('h3', title));
    for (const field of fields) {
      if (Array.isArray(field.value)) {
        const fieldset = element('fieldset', '', 'adaptation-plan-list-editor');
        fieldset.append(element('legend', field.label));
        const rows = element('div', '', 'adaptation-plan-list-inputs');
        const renumber = () => [...rows.children].forEach((row, i) => {
          row.querySelector('textarea').setAttribute('aria-label', `${field.label} ${i + 1}`);
          row.querySelector('button').setAttribute('aria-label', `删除${field.label} ${i + 1}`);
        });
        const add = (value = '') => {
          const row = element('div', '', 'adaptation-plan-list-input'), input = element('textarea');
          input.value = value; input.spellcheck = false;
          row.append(input, button('删除', () => { row.remove(); renumber(); })); rows.append(row); renumber();
        };
        for (const value of field.value) add(value);
        fieldset.append(rows, button(`添加${field.label}`, () => add())); form.append(fieldset);
        inputs[field.key] = () => [...rows.querySelectorAll('textarea')].map(input => input.value).filter(value => value.trim());
      } else {
        const label = element('label', field.label), input = element('textarea');
        input.setAttribute('aria-label', field.label); input.value = field.value; input.spellcheck = false;
        if (field.required) input.required = true;
        label.append(input); form.append(label); inputs[field.key] = () => input.value;
      }
    }
    const footer = element('div', '', 'node-ui-buttons');
    const submit = button('保存'); submit.type = 'submit';
    footer.append(button('取消', close), submit); form.append(error, footer);
    form.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([key, read]) => [key, read()]));
      if (fields.some(field => field.required && !values[field.key].trim())) { error.textContent = '请填写原著内容和改编方案。'; return; }
      submit.disabled = true; error.textContent = '';
      try { await apply(next => change(next, values)); }
      catch (cause) { error.textContent = cause.message; }
      finally { submit.disabled = false; }
    };
    dialog.append(form); root.append(dialog); showPanelDialog(dialog);
  };
  root.classList.add('adaptation-plan-panel');
  const failure = element('p', '', 'error'); failure.setAttribute('role', 'alert'); failure.hidden = true; root.append(failure);
  const group = (key, title) => {
    const section = element('section', '', 'role-module-card production-guidance-group');
    section.dataset.guidanceGroup = key;
    const cards = element('div', '', 'production-guidance-cards'); section.append(element('h3', title), cards); root.append(section);
    return { section, cards };
  };
  const textCard = (target, title, content, action, placeholder) => {
    const card = element('article', '', 'production-card'); card.append(element('h4', title), element('p', content || placeholder, content ? 'production-text' : 'meta'));
    if (onChange) card.append(button(`编辑${title}`, action)); target.append(card);
  };
  const overview = group('overview', '改编定位');
  const properties = element('dl', '', 'adaptation-plan-properties');
  for (const [key, title] of [['audience', '受众'], ['style', '风格']]) {
    const row = element('div', '', 'adaptation-plan-property');
    row.append(element('dt', `${title}：`), element('dd', plan[key] || `尚未填写${title}。`, plan[key] ? 'production-text' : 'meta'));
    if (onChange) {
      const edit = button('编辑', () => open(`编辑${title}`, [{ key, label: title, value: plan[key] }], (next, values) => { next[key] = values[key]; }));
      edit.setAttribute('aria-label', `编辑${title}`); row.append(edit);
    }
    properties.append(row);
  }
  overview.cards.append(properties);
  const direction = group('story_direction', '故事方向');
  textCard(direction.cards, '主线方向', plan.story_direction.main_plot, () => open('编辑主线方向', [{ key: 'main_plot', label: '主线方向', value: plan.story_direction.main_plot }], (next, values) => { next.story_direction.main_plot = values.main_plot; }), '尚未填写主角目标、核心冲突、因果推进和结局方向。');
  for (const [key, title, placeholder] of [['must_preserve', '必须保留的情节', '暂无必须保留的情节。'], ['constraints', '创作约束', '暂无创作约束。']]) {
    const card = element('article', '', 'production-card'); card.append(element('h4', title));
    if (plan.story_direction[key].length) {
      const list = element('ol', '', 'adaptation-plan-text-list');
      for (const item of plan.story_direction[key]) list.append(element('li', item)); card.append(list);
    } else card.append(element('p', placeholder, 'meta'));
    if (onChange) card.append(button(`编辑${title}`, () => open(`编辑${title}`, [{ key, label: title, value: plan.story_direction[key] }], (next, values) => { next.story_direction[key] = values[key]; })));
    direction.cards.append(card);
  }
  for (const [key, title, noun] of [['character_plans', '人物规划', '人物'], ['group_plans', '团队规划', '团队'], ['scene_plans', '场景规划', '场景']]) {
    const { cards } = group(key, title);
    const edit = (index) => {
      const current = plan[key][index];
      open(`编辑${noun}规划`, [
        { key: 'original_content', label: '原著内容', value: current.original_content, required: true },
        { key: 'adaptation_plan', label: '改编方案', value: current.adaptation_plan, required: true },
      ], (next, values) => { next[key][index] = values; });
    };
    if (!plan[key].length) { const card = element('article', '', 'production-card'); card.append(element('p', `暂无${title}。`, 'meta')); cards.append(card); }
    plan[key].forEach((item, index) => {
      const card = element('article', '', 'production-card'); card.dataset.planIndex = String(index); card.append(element('h4', `${noun}规划 ${index + 1}`));
      const pair = element('div', '', 'adaptation-plan-pair');
      for (const [field, label] of [['original_content', '原著内容'], ['adaptation_plan', '改编方案']]) {
        const block = element('div'); block.append(element('h5', label), element('p', item[field], 'production-text')); pair.append(block);
      }
      card.append(pair);
      if (onChange) {
        const actions = element('div', '', 'node-ui-buttons');
        actions.append(button('编辑此项', () => edit(index)), button('删除此项', async () => {
          failure.hidden = true;
          try { await apply(next => { next[key].splice(index, 1); }); }
          catch (cause) { failure.textContent = cause.message; failure.hidden = false; }
        }));
        card.append(actions);
      }
      cards.append(card);
    });
  }
  return { dispose: close };
}
