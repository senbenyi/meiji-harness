import { promptData } from './prompt-data.js'

// New contract fixtures: content is structured; callers choose explicit actions/durations.
export function secondsContent(shotId = 'S01', duration = 5, action = '【旅人|C01】朝北行走') {
  return { version: 1, shotId, summary: '进入庭院', beats: [{ id: 'B01', durationMs: duration * 1000, transition: 'continue', action, camera: '摄影机位于身后，固定全景', space: '【庭院|E01】南门北墙', sound: '脚步声', endState: '面北站定', dialogueIds: [] }], dialogues: [], ambient: [], music: [] }
}
export function secondsResponse(rows = [['S01', 5, '第一镜新动作'], ['S02', 5, '第二镜接续动作']]) {
  return JSON.stringify({ shots: rows.map(([id, duration, action]) => secondsContent(id, duration, action)) })
}

// 模拟网关按明确的单镜任务返回该镜，默认正文用于集成回归。
export function secondsForRequest({ user }, rows = [['S01', 5, '第一镜新动作'], ['S02', 5, '第二镜接续动作']]) {
  const id = promptData(user, '【本次要求】').shotId
  const row = rows.find(row => row[0] === id)
  if (!row) throw new Error(`测试未提供 ${id} 的响应`)
  return secondsResponse([row])
}
