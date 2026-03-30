import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolvePreloadPath(): string {
  const jsPath = join(__dirname, '../preload/index.js')
  if (existsSync(jsPath)) {
    return jsPath
  }

  return join(__dirname, '../preload/index.mjs')
}
