import { BrowserWindow, screen } from 'electron'
import type { AppState } from '@shared/schema'
import { IPC_CHANNELS } from '@shared/ipc'
import { loadRenderer } from './loadRenderer'
import { resolvePreloadPath } from './preloadPath'

export class ShelfWindow {
  private window: BrowserWindow | null = null

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new BrowserWindow({
      width: 396,
      height: 504,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      alwaysOnTop: true,
      type: 'panel',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: false
      }
    })

    this.window.setAlwaysOnTop(true, 'floating')
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    this.window.on('closed', () => {
      this.window = null
    })
    await loadRenderer(this.window, 'shelf')
    return this.window
  }

  async showNear(point: { x: number; y: number }, inactive = false): Promise<void> {
    const window = await this.ensure()
    const bounds = computeBounds(point, window.getBounds().width, window.getBounds().height)
    window.setBounds(bounds, false)

    if (inactive) {
      window.showInactive()
      return
    }

    window.show()
    window.focus()
  }

  hide(): void {
    this.window?.closeFilePreview()
    this.window?.hide()
  }

  sendState(state: AppState): void {
    this.window?.webContents.send(IPC_CHANNELS.stateUpdated, state)
  }

  previewFile(path: string, displayName?: string): boolean {
    if (!this.window) {
      return false
    }

    this.window.previewFile(path, displayName)
    return true
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window
  }
}

function computeBounds(point: { x: number; y: number }, width: number, height: number) {
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  const padding = 16
  const x = Math.min(Math.max(area.x + padding, point.x - width / 2), area.x + area.width - width - padding)
  const y = Math.min(Math.max(area.y + padding, point.y - 52), area.y + area.height - height - padding)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height
  }
}
