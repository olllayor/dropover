import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = resolve(__dirname, '.')
const shared = resolve(root, 'src/shared')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    build: {
      outDir: 'out/main',
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'src/main/index.ts')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    build: {
      outDir: 'out/preload',
      sourcemap: 'inline',
      rollupOptions: {
        input: resolve(root, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(root, 'src/renderer/src')
      }
    },
    build: {
      outDir: '../../out/renderer'
    },
    plugins: [react()]
  }
})
