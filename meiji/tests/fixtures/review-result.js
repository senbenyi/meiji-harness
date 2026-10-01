export const reviewPass = JSON.stringify({ passed: true, issues: [] })
export const reviewFail = (reason, location = '本次内容', requirement = '修正上述问题') => JSON.stringify({
  passed: false, issues: [{ location, reason, requirement }],
})
