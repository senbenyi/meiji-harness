/** Hard runtime policy for one novel-workflow child Agent. */
export function installNovelChildPolicy(agent, { maxSteps = 6, maxStructuredOutputs = 2 } = {}) {
  agent.ctx.tools.restrict({ allow: [] })
  let structuredOutputs = 0
  agent.ctx.tools.guard(({ name }) => {
    if (name !== 'structured_output') return `novel workflow child cannot call ${name}`
    structuredOutputs += 1
    return structuredOutputs > maxStructuredOutputs
      ? `novel workflow child exceeded the ${maxStructuredOutputs}-call structured output budget`
      : undefined
  })
  agent.ctx.on('agent/pre-step', (payload, next) => payload.step > maxSteps ? { kind: 'reject' } : next())
}
