// 项目文档独立校验器，不导入旧节点注册表或业务输出定义。
export function validateDocumentSchema(schema,value,path='project') {
 const fail=message=>{throw Object.assign(new TypeError(`${path}：${message}`),{code:'INVALID_PROJECT_DOCUMENT',path})}
 if(schema.oneOf){let count=0;for(const item of schema.oneOf)try{validateDocumentSchema(item,value,path);count++}catch(error){if(error.code!=='INVALID_PROJECT_DOCUMENT')throw error}if(count!==1)fail('需匹配唯一的数据类型');return}
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('必须为普通对象')
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))fail(`缺少字段${key}`)
  for(const [key,item]of Object.entries(value)){if(!Object.hasOwn(schema.properties||{},key)){if(schema.additionalProperties===false)fail(`不允许字段${key}`);continue}validateDocumentSchema(schema.properties[key],item,`${path}.${key}`)}
 }else if(schema.type==='array'){
  if(!Array.isArray(value))fail('必须为数组');if(schema.minItems!==undefined&&value.length<schema.minItems)fail('数组不足最小长度');if(schema.maxItems!==undefined&&value.length>schema.maxItems)fail('数组超出最大长度');for(let i=0;i<value.length;i++)validateDocumentSchema(schema.items,value[i],`${path}[${i}]`)
 }else if(schema.type==='string'){
  if(typeof value!=='string'||value.trim().length<(schema.minLength||0))fail('文本为空或类型错误');if(schema.maxLength!==undefined&&value.length>schema.maxLength)fail('文本超出最大长度')
 }else if(schema.type==='number'||schema.type==='integer'){
  if(typeof value!=='number'||!Number.isFinite(value)||schema.type==='integer'&&!Number.isSafeInteger(value)||schema.minimum!==undefined&&value<schema.minimum)fail('数字范围或类型错误')
 }else if(schema.type==='boolean'){if(typeof value!=='boolean')fail('必须为布尔值')}
 else if(schema.type==='null'){if(value!==null)fail('必须为null')}
 else fail('未知校验类型')
 if(Object.hasOwn(schema,'const')&&value!==schema.const)fail('固定值错误')
 if(schema.enum&&!schema.enum.includes(value))fail('值不在允许范围')
}
