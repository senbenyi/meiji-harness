const SECRET_KEYS = /authorization|api.?key|token|secret|password|prompt/i

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[redacted]' : redact(item)]))
}

export function diagnosticEvent(type, detail = {}) {
  return { type, timestamp: new Date().toISOString(), detail: redact(detail) }
}
