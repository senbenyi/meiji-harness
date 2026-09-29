import { emptyFeedback, feedbackKey } from '../shared/feedback.js'

// Translate legacy storage once on load/save; runtime consumers only use feedback.
export function migrateFeedback(source) {
  const project = structuredClone(source)
  project.feedback ||= {}
  const entry = key => project.feedback[key] ||= emptyFeedback()
  const move = (owner, field, key) => {
    if (!owner || !Object.hasOwn(owner, field)) return
    const old = owner[field]
    if (old) {
      const target = entry(key)
      const failures = old.failures || old.reasons || []
      target.check = { passed: old.passed ?? null, failures: [...new Set([...target.check.failures, ...failures])], ...(old.updatedAt ? { updatedAt: old.updatedAt } : {}) }
    }
    delete owner[field]
  }
  for (const [field, key] of Object.entries({ selfCheck: 'summary', outlineSelfCheck: 'outline', storyboardSelfCheck: 'storyboard', assemblySelfCheck: 'assembly' })) move(project, field, key)
  for (const key of ['brief', 'characters', 'scenes', 'shots']) {
    const bag = project[key]
    if (!bag) continue
    move(bag, 'selfCheck', key)
    // check is also the transient validator result produced by generators.
    if (bag.check) entry(key).check = { passed: bag.check.passed, failures: bag.check.failures || [] }
    delete bag.check
    if (bag.review != null) entry(key).review.text = String(bag.review)
    delete bag.review
    for (const item of bag.items || []) {
      const target = key === 'shots' ? `shot:${item.id}` : `${key}:${item.id}`
      move(item, 'selfCheck', target)
      move(item, 'check', target)
      if (item.review) entry(target).review.text = String(item.review)
      delete item.review
      move(item, 'secondsSelfCheck', `seconds:${item.id}`)
      move(item, 'storyboardSelfCheck', `storyboard:${item.id}`)
      move(item, 'imageSelfCheck', `image:${item.id}`)
      for (const slot of Object.keys(item.partSelfChecks || {})) move(item.partSelfChecks, slot, `image:${item.id}:${slot}`)
      delete item.partSelfChecks
    }
  }
  for (const item of project.storyboard || []) move(item, 'selfCheck', `storyboard:${item.id}`)
  for (const [id, item] of Object.entries(project.boards || {})) move(item, 'selfCheck', `pencil:${id}`)
  for (const [id, item] of Object.entries(project.films || {})) move(item, 'selfCheck', `film:${id}`)
  for (const [key, status] of Object.entries(project.reviews || {})) entry(key).review.status = status
  for (const item of project.reviewHistory || []) {
    const review = entry(feedbackKey(item)).review
    if (!review.history.some(old => old.createdAt === item.createdAt && old.text === item.text)) review.history.push({ text: item.text, createdAt: item.createdAt })
  }
  for (const key of ['summary', 'brief', 'outline', 'characters', 'scenes', 'shots', 'seconds', 'storyboard', 'films', 'assembly']) entry(key)
  for (const item of project.shots?.items || []) {
    for (const name of ['shot', 'seconds', 'storyboard', 'pencil', 'film']) entry(`${name}:${item.id}`)
  }
  for (const name of ['characters', 'scenes']) {
    for (const item of project[name]?.items || []) {
      entry(`${name}:${item.id}`)
      entry(`image:${item.id}`)
      for (const slot of ['clothes', 'props', 'hairstyles']) {
        if (Object.hasOwn(item, slot)) entry(`image:${item.id}:${slot}`)
      }
    }
  }
  for (const record of Object.values(project.feedback)) {
    const pending = (project.reviewHistory || []).map(item => item.text).filter(text => record.review.history.some(item => item.text === text) && record.check.failures.includes(text))
    if (pending.length) {
      record.review.text = [...new Set([record.review.text, ...pending].filter(Boolean))].join('\n')
      record.check.failures = record.check.failures.filter(text => !pending.includes(text))
      if (!record.check.failures.length && record.check.passed === false) record.check.passed = null
    }
    if (record.review.text) record.review.status = 'changes-requested'
  }
  delete project.reviews
  delete project.reviewHistory
  return project
}
