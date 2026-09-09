// Import through the preset tree so linked installations use the host's modules.
export const inject = ['loader', 'agentPresets']

export async function apply(ctx, config) {
  const tree = ctx.fiber.entry.parent.tree
  const yaml = await tree.import('js-yaml')
  const { entryListSchema, applyEntryPatches } = await tree.import('@deepseek-ai/cordis-plugin-include')
  const standard = yaml.load(await ctx.agentPresets.readComposition('standard'), { schema: entryListSchema })
  const rows = applyEntryPatches(standard, config.patches, (message, id) => {
    throw new Error(`Elysium standard preset patch failed: ${message} (${id})`)
  })
  // The native group preserves isolation and uses the preset's read-only tree.
  await ctx.plugin(ctx.loader.builtins.group, rows).await()
}
