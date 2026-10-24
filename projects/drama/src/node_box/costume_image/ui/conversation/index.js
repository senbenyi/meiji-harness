export const conversation = {
  renderStepOutput(body, result, { node }) {
    if (!result?.output?.address) return false
    const image = node('img'); image.src = result.output.address; image.alt = '本次生成的角色定妆照'; image.style.maxWidth = '100%'
    body.append(image); return true
  },
  outcome(group) {
    return { headline: group.context.saved ? '定妆照已保存' : '定妆照任务已结束',
      description: '生成结果按每张照片分别记录，批次失败时停止剩余照片。', retained: '已保存图片保留，可在角色页查看、放大或重新生成。' }
  },
}
