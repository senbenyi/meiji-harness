// 步骤计划构造：任务与操作定义 plan 时共用。
// 文本分镜 = 以已通过每秒指令直接编排多模态引用（不再单独生成文本镜头）。
export const storyboardSteps = track => ['generate', 'review'].map(kind => ({ kind, target: `storyboard:${track}`, phase: 'reference-binding', label: `引用编排·${kind === 'generate' ? '生成' : '自审'}` }))
export const videoSteps = track => ['video_submit', 'video_generate', 'tail_frame'].map(kind => ({ kind, target: `film:${track}` }))
export const editSteps = target => [{ kind: 'save', target }, { kind: 'review', target }]
export const saveStep = target => op => ({ kind: 'save', target: typeof target === 'function' ? target(op) : target })
export const imageSteps = target => ['image_generate', 'image_download', 'image_save'].map(kind => ({ kind, target }))
