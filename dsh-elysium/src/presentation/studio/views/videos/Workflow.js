const STAGES = [
  {
    key: 'plan',
    title: '策划',
    hint: '先把这一集想清楚',
    label: '一句话目标',
    placeholder: '例如：讲一个关于重逢与选择的短故事',
  },
  {
    key: 'script',
    title: '编剧',
    hint: '写出完整剧情',
    label: '剧情梗概',
    placeholder: '简单写明开场、冲突和结尾',
  },
  {
    key: 'shots',
    title: '分镜',
    hint: '把剧情拆成镜头',
    label: '镜头安排',
    placeholder: '例如：镜头 1 远景建立场景；镜头 2 人物近景',
  },
  {
    key: 'produce',
    title: '出片',
    hint: '生成并验收成片',
    label: '出片备注',
    placeholder: '填写风格、画幅和时长要求',
  },
]

export function createWorkflow(React) {
  const { createElement: h, useState } = React

  return function Workflow() {
    const [active, setActive] = useState(0)
    const [values, setValues] = useState({ plan: '', script: '', shots: '', produce: '' })
    const stage = STAGES[active]

    return h('div', { className: 'tf-workflow' },
      h('div', { className: 'tf-header' },
        h('div', null,
          h('div', { className: 'tf-title' }, '短剧创作'),
          h('div', { className: 'tf-card-meta' }, '策划 → 编剧 → 分镜 → 出片'),
        ),
      ),
      h('div', { className: 'tf-workflow-steps' },
        STAGES.map((item, index) => h('button', {
          key: item.key,
          className: `tf-workflow-step${index === active ? ' is-active' : ''}${index < active ? ' is-done' : ''}`,
          onClick: () => setActive(index),
        },
        h('span', { className: 'tf-workflow-step-number' }, index < active ? '✓' : index + 1),
        h('span', null, item.title),
        )),
      ),
      h('section', { className: 'tf-workflow-card' },
        h('div', { className: 'tf-workflow-kicker' }, `第 ${active + 1} 步`),
        h('h2', { className: 'tf-workflow-title' }, stage.title),
        h('p', { className: 'tf-workflow-hint' }, stage.hint),
        h('label', { className: 'tf-form-field' },
          h('span', { className: 'tf-form-label' }, stage.label),
          h('textarea', {
            className: 'tf-textarea tf-workflow-input',
            value: values[stage.key],
            placeholder: stage.placeholder,
            onChange: event => setValues(current => ({ ...current, [stage.key]: event.target.value })),
          }),
        ),
        h('div', { className: 'tf-workflow-actions' },
          h('button', {
            className: 'tf-btn tf-btn-ghost',
            disabled: active === 0,
            onClick: () => setActive(index => Math.max(0, index - 1)),
          }, '上一步'),
          active < STAGES.length - 1
            ? h('button', {
              className: 'tf-btn',
              onClick: () => setActive(index => Math.min(STAGES.length - 1, index + 1)),
            }, '下一步')
            : h('button', { className: 'tf-btn', disabled: true }, '生成成片（待接入）'),
        ),
      ),
      h('div', { className: 'tf-workflow-note' }, '当前只是 UI 草图，内容不会保存，也不会提交生成任务。'),
    )
  }
}
