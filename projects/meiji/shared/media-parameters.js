export const PROJECT_ASPECT_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

export function videoSizeOf(value = '9:16') {
  const sizes = { '21:9':'1344x576', '16:9':'1024x576', '4:3':'1024x768', '1:1':'768x768', '3:4':'768x1024', '9:16':'576x1024' };
  if (!sizes[value]) throw Object.assign(new Error('视频画幅需为 ' + PROJECT_ASPECT_RATIOS.join('、')), {status:400});
  return sizes[value];
}

// 导出使用精确比例，短边至少768，偶数像素满足H.264编码要求。
export function projectFrameSize(ratio) {
  if (!PROJECT_ASPECT_RATIOS.includes(ratio)) throw new Error('视频输出画幅无效');
  let [w,h] = ratio.split(':').map(Number);
  let a=w,b=h;
  while (b) [a,b]=[b,a%b];
  w/=a;h/=a;
  const scale=Math.ceil(768/Math.min(w,h)/2)*2;
  return [w*scale,h*scale];
}

export function aspectRatioOfSize(size) {
  const [w,h]=size.split('x').map(Number);
  return PROJECT_ASPECT_RATIOS.find(ratio=>{const [a,b]=ratio.split(':').map(Number);return w*b===h*a;}) || '';
}
