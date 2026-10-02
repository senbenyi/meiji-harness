const textOf = (error) => String(error?.message || error || '')

export function classifyGenerationFailure(error, { stage = '' } = {}) {
  const message = textOf(error)
  const lower = message.toLowerCase()
  let failureClass = 'remote_failure'
  let retryable = false

  if (/401|403|unauthori[sz]ed|forbidden|api.?key|authentication/.test(lower)) failureClass = 'authentication'
  else if (/429|rate.?limit|too many requests/.test(lower)) { failureClass = 'rate_limit'; retryable = true }
  else if (/download|\/view\?|comfy-download-failed/.test(lower)) { failureClass = 'download_failure'; retryable = true }
  else if (/timeout|timed out|network|unreachable|econn|enotfound|socket|fetch failed/.test(lower)) { failureClass = 'transient_network'; retryable = true }
  else if (/workflow-validation|invalid|unsupported|missing|required|400|422/.test(lower)) failureClass = 'invalid_input'
  else if (/config|no runtime_verified|not configured/.test(lower)) failureClass = 'configuration'

  return {
    failureClass,
    retryable,
    submissionUncertain: stage === 'submit' && failureClass === 'transient_network',
    message,
  }
}
