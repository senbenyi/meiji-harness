export function latestUserGoal(agent) {
  const events = agent?.session?.snapshotEvents?.() || []
  const message = events.findLast(event => event.type === 'user/message' && event.data?.source?.kind === 'user')?.data
  return message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '创建项目'
}
