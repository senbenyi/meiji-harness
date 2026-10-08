const characterLabels = ['国籍', '姓名', '身份', '性别', '年代', '年龄', '服装', '身高', '体型', '身型', '面相', '面向']

function labeledParts(text, labels) {
  const source = String(text || '')
  const parts = {}
  labels.forEach((label, order) => {
    const mark = `${label}：`
    const start = source.indexOf(mark)
    if (start < 0) return
    const from = start + mark.length
    const next = labels.slice(order + 1).map(item => source.indexOf(`${item}：`, from)).find(index => index >= 0)
    parts[label] = source.slice(from, next === undefined ? source.length : next).trim()
  })
  return parts
}

export function characterFieldValues(item) {
  const parsed = labeledParts(item?.look, characterLabels)
  const build = [item?.build || parsed.体型, item?.figure || parsed.身型].map(value => String(value || '').trim()).filter(Boolean)
  return {
    nationality: String(item?.nationality || parsed.国籍 || '中国').trim(),
    name: String(item?.name || parsed.姓名 || '').trim(),
    role: String(item?.role || parsed.身份 || '').trim(),
    gender: String(item?.gender || parsed.性别 || '').trim(),
    era: String(item?.era || parsed.年代 || '').trim(),
    age: String(item?.age || parsed.年龄 || '').trim(),
    costume: String(item?.costume || parsed.服装 || '').trim(),
    height: String(item?.height || parsed.身高 || '').trim(),
    build: build.filter((value, index) => build.indexOf(value) === index).join('，'),
    features: String(item?.features || parsed.面相 || '').trim(),
    voiceDescription: String(item?.voiceDescription || '').trim(),
    identity: String(item?.identity || '').trim(),
  }
}

export function characterSheet(item) {
  const values = characterFieldValues(item)
  return [
    ['国籍', values.nationality],
    ['姓名', values.name],
    ['身份', values.role],
    ['性别', values.gender],
    ['年代', values.era],
    ['年龄', values.age],
    ['服装', values.costume],
    ['身高', values.height],
    ['体型', values.build],
    ['面相', values.features],
    ['声音特征', values.voiceDescription],
  ]
}

const factKeys = ['nationality', 'name', 'role', 'gender', 'era', 'age', 'costume', 'height', 'build', 'features']

export function characterFactLine(values) {
  return factKeys.map(key => String(values?.[key] || '').trim()).filter(Boolean).join('，')
}

export function characterFactText(item) {
  return characterFactLine(characterFieldValues(item))
}

export function characterLookText(values) {
  return [
    ['国籍', values.nationality],
    ['姓名', values.name],
    ['身份', values.role],
    ['性别', values.gender],
    ['年代', values.era],
    ['年龄', values.age],
    ['服装', values.costume],
    ['身高', values.height],
    ['体型', values.build],
    ['面相', values.features],
  ].map(([label, value]) => `${label}：${value}`).join('\n')
}
