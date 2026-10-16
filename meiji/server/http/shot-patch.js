import { invalid, assertFields } from '../../shared/task_contract.js';
import { validateShape } from './validate-shape.js';

export function resolveShotPatch(value, input, shape, action) {
  if (action !== 'regenerate') return value;
  const base = input.content?.shots;
  if (value?.mode === 'patch') {
    assertFields(value, ['mode', 'shots'], '局部修订');
    if (!Array.isArray(base) || !Array.isArray(value.shots)) invalid('局部修订', '需有完整基稿和修订数组');
    const ids = new Map(), seen = new Set();
    base.forEach((row, index) => { if (row.id) { if (ids.has(row.id)) invalid('局部修订', '基稿镜头ID重复'); ids.set(row.id, index); } });
    const merged = structuredClone(base);
    for (const row of value.shots) {
      let index;
      if (Object.hasOwn(row, 'candidate_index')) {
        assertFields(row, ['candidate_index', 'title', 'changes'], '局部修订.shots[]');
        index = row.candidate_index;
        if (!Number.isInteger(index) || index < 0 || index >= base.length || base[index].id
          || typeof row.title !== 'string' || row.title !== base[index].title || seen.has(index))
          invalid('局部修订.candidate_index', '仅可定位完整基稿中id为空的新镜头；从0开始的数组位置与原title必须同时一致，不能越界、重复或代替已有正式ID');
      } else {
        assertFields(row, ['id', 'changes'], '局部修订.shots[]');
        if (typeof row.id !== 'string' || !row.id || !ids.has(row.id) || seen.has(ids.get(row.id)))
          invalid('局部修订.id', '未知、重复或空镜头ID；从完整基稿原样复制' + (base.some(item => !item.id) ? '。基稿含尚未分配ID的新镜头：局部修改使用candidate_index（从0开始）与原title共同定位，不含id；或用mode=replace返回完整表，新镜头id仍为空' : ''));
        index = ids.get(row.id);
      }
      seen.add(index);
      if (!row.changes || typeof row.changes !== 'object' || Array.isArray(row.changes) || !Object.keys(row.changes).length)
        invalid('局部修订.changes', '需为非空字段对象');
      const keys = Object.keys(row.changes);
      if (keys.some(key => key === 'id' || !Object.hasOwn(shape, key))) invalid('局部修订.changes', '只能改镜头内容字段，不能改ID或新增字段');
      validateShape(row.changes, Object.fromEntries(keys.map(key => [key, shape[key]])), '局部修订.changes');
      Object.assign(merged[index], structuredClone(row.changes));
    }
    return { shots: merged };
  }
  if (value?.mode === 'replace') assertFields(value, ['mode', 'shots'], '全表修订');
  if (value?.mode !== undefined && value.mode !== 'replace') invalid('响应.mode', '仅允许patch或replace');
  if (Array.isArray(base) && Array.isArray(value?.shots) && value.mode !== 'replace') {
    const oldIds = base.map(row => row.id), nextIds = value.shots.map(row => row.id);
    if (oldIds.length !== nextIds.length || oldIds.some((id, i) => id !== nextIds[i]))
      invalid('镜头表修订', '增删、拆并或重排镜头须显式mode=replace并返回完整镜头表；局部修改请用mode=patch，未返回的镜头不表示删除');
  }
  return value?.mode === 'replace' ? { shots: value.shots } : value;
}
