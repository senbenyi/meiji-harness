import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'

await rm('lib/client.css', { force: true })

await build({
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  plugins: [{
    name: 'inline-toonflow-css',
    setup(builder) {
      builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => ({
        contents: await readFile(path, 'utf8'),
        loader: 'text',
      }))
    },
  }],
  legalComments: 'none',
  logLevel: 'info',
})
