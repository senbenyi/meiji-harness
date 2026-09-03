import configs from './tsdown.config.ts'

const server = configs[0]
if (server === undefined) throw new Error('server build config is missing')

export default {
  ...server,
  outDir: 'registry/lib',
}
