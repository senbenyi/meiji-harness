// 即时保存的步骤描述：人工编辑先保存再审核，其余只有保存。
export const editSteps = target => [{ kind: 'save', target }, { kind: 'review', target }]
export const saveStep = target => op => ({ kind: 'save', target: typeof target === 'function' ? target(op) : target })
