import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { URL } from 'node:url'

export type RendererView = 'shelf' | 'preferences'

export async function loadRenderer(window: BrowserWindow, view: RendererView): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', view)
    await window.loadURL(url.toString())
    return
  }

  await window.loadFile(join(__dirname, '../renderer/index.html'), {
    query: {
      view
    }
  })
}
