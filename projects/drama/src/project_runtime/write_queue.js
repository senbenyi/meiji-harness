/** 项目管理和所有节点盒子共用；失败不阻塞后续操作，模型请求不占队列。 */
export function createWriteQueue() {
  let tail = Promise.resolve()
  return {
    run(operation) {
      const pending = tail.catch(() => {}).then(operation)
      tail = pending
      return pending
    },
  }
}
