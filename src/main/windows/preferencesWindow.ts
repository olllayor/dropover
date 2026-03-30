import { BrowserWindow } from 'electron'
import type { AppState } from '@shared/schema'
import { IPC_CHANNELS } from '@shared/ipc'
import { loadRenderer } from './loadRenderer'
import { resolvePreloadPath } from './preloadPath'

export class PreferencesWindow {
  private window: BrowserWindow | null = null

  async show(): Promise<void> {
    const window = await this.ensure()
    window.show()
    window.focus()
  }

  sendState(state: AppState): void {
    this.window?.webContents.send(IPC_CHANNELS.stateUpdated, state)
  }

  private async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new BrowserWindow({
      width: 860,
      height: 720,
      minWidth: 760,
      minHeight: 640,
      show: false,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#171516',
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: false
      }
    })
    this.window.on('closed', () => {
      this.window = null
    })
    await loadRenderer(this.window, 'preferences')
    return this.window
  }
}
