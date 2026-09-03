import configs from './tsdown.config.ts'

const registryClient = configs[2]
if (registryClient === undefined) throw new Error('registry client build config is missing')

export default {
  ...registryClient,
  outDir: 'registry/lib',
}
