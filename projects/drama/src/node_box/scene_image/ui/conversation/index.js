import {readable} from '../../../../client/ui/readable.js'
export const conversation = {
  renderInput(body,data,{node}){
    if(!data.scene)return false
    body.append(node('h4','场景资料'),node('pre',readable(data.scene)))
    if(data.instruction)body.append(node('h4','生图要求'),node('p',data.instruction))
    if(data.reference_image?.startsWith('data:image/')){const image=node('img');image.src=data.reference_image;image.alt='本次参考图';image.style.width='72px';body.append(image)}
    return true
  },
  renderStepOutput(body,result,{node}){if(!result?.output?.address)return false;const image=node('img');image.src=result.output.address;image.alt='本次生成的场景图';image.style.maxWidth='100%';body.append(image);return true},
  outcome(group){return{headline:group.context.saved?'场景图已保存':'场景图任务已结束',description:group.context.saved?'场景图已更新，可在场景卡片查看。':'本次未更新场景图。',retained:'已保存的场景图保留，可在场景卡片重新生成。'}},
}
