// 职责：记录任务各阶段的单调时钟耗时。
import { performance } from 'node:perf_hooks'

// Nested/concurrent spans overlap; only total_ms is elapsed wall time.
export function createTiming() {
  const started = performance.now(), stages = {}
  return {
    async measure(name, action) {
      const start = performance.now()
      let failed = false
      try { return await action() } catch (error) { failed = true; throw error } finally {
        const end = performance.now()
        const stage = stages[name] ||= { count: 0, failed: 0, total_ms: 0, max_ms: 0 }
        stage.count++
        stage.failed += Number(failed)
        stage.total_ms += end - start
        stage.max_ms = Math.max(stage.max_ms, end - start)
        stage.last_start_ms = start - started
        stage.last_end_ms = end - started
      }
    },
    snapshot() {
      return { clock: 'performance.now', total_ms: performance.now() - started, stages: structuredClone(stages) }
    },
  }
}
// 职责：记录任务总耗时及各阶段调用次数、失败和耗时。
