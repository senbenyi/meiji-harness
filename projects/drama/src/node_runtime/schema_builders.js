// 仅构建本项目使用的Schema片段；各盒子维护自己的字段和约束。
export const string = (description, options = {}) => ({ type: 'string', description, ...options })
export const number = (description, options = {}) => ({ type: 'number', description, ...options })
export const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export const array = (items, options = {}) => ({ type: 'array', items, ...options })
