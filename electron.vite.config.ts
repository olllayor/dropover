import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = resolve(__dirname, '.')
const shared = resolve(root, 'src/shared')
const rendererCspByMode = {
  serve:
    "default-src 'self' http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:* ws://localhost:*;",
  build: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';"
} as const

export default defineConfig(({ command }) => ({
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
    plugins: [
      react(),
      {
        name: 'inject-renderer-csp',
        transformIndexHtml(html) {
          const csp = rendererCspByMode[command === 'serve' ? 'serve' : 'build']
          return html.replace('__APP_CSP__', csp)
        }
      }
    ]
  }
}))
