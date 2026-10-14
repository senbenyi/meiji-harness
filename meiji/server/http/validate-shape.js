import { invalid } from '../../shared/task_contract.js';

export function validateShape(value, shape, path = "响应") {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) invalid(path, "需为数组");
    for (const row of value) validateShape(row, shape[0], path + "[]");
    return;
  }
  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "需为对象");
    for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) invalid(path + "." + key, "未定义字段");
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(value, key)) invalid(path + "." + key, "缺少字段");
      validateShape(value[key], shape[key], path + "." + key);
    }
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) invalid(path, '需为有限数值');
  if (typeof value !== typeof shape) invalid(path, `需为 ${typeof shape}`);
}

