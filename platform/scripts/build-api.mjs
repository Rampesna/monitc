import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: {
    index: 'src/index.ts',
    worker: 'src/worker.ts',
    'bootstrap-admin': 'src/bootstrap-admin.ts'
  },
  outdir: 'dist',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info'
})
