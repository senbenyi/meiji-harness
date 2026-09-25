// Time ranges use elapsed seconds: 0–5s covers the first five seconds.
export function shotSegments(shot) {
  const rows = shot?.seconds
  const duration = Number(shot?.duration)
  if (!Array.isArray(rows) || !rows.length || !Number.isInteger(duration) || duration < 1) return null
  const legacy = rows.every(row => !row.range) && rows.length === duration
  let cursor = 0
  const segments = []
  for (const row of rows) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*$/i.exec(String(row.range || ''))
    const start = legacy ? cursor : match ? Number(match[1]) : NaN
    const end = legacy ? cursor + 1 : match ? Number(match[2]) : NaN
    if (start !== cursor || !Number.isFinite(end) || end <= start || end - start > 5 || end > duration) return null
    segments.push({ ...row, range: `${start}–${end}s` })
    cursor = end
  }
  return cursor === duration ? segments : null
}
export function shotSecondsReady(shot) {
  if (typeof shot?.secondsText === 'string') return Boolean(shot.secondsText.trim())
  const rows = shotSegments(shot)
  return Boolean(rows && rows.every(row => ['action', 'camera', 'space', 'audio', 'handoff'].every(key => typeof row[key] === 'string' && row[key].trim())))
}
