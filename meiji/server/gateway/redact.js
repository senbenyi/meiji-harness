export function publicHeaders(headers, apiKey) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => {
    const hidden = /authorization/i.test(key) || (apiKey && String(value).includes(apiKey))
    return [key, hidden ? '[已隐藏]' : value]
  }))
}

export function publicData(value, apiKey) {
  const json = JSON.stringify(value, (key, item) => {
    if (/api[_-]?key|authorization/i.test(key)) return '[已隐藏]'
    if ((key === 'b64_json' || key === 'input_reference' || key === 'last_frame') && typeof item === 'string') return `[base64 图片，${item.length} 字符]`
    if (typeof item === 'string') return item.replace(/data:[^,\s]*;base64,[A-Za-z0-9+/_=-]+/g, data => `[base64 数据，${data.length - data.indexOf(',') - 1} 字符]`)
    return item
  })
  // JSON.stringify(undefined) 返回 undefined（如 GET 请求没有 body），直接返回。
  if (typeof json !== 'string') return json
  return apiKey ? json.replaceAll(apiKey, '[已隐藏]') : json
}


export function redactJson(value, apiKey) {
  const text = publicData(value, apiKey)
  return text === undefined ? null : JSON.parse(text)
}
