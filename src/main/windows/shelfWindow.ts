import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';

export class ShelfWindow {
  private window: BrowserWindow | null = null;
  private manualBounds: Rectangle | null = null;
  private programmaticMoveDepth = 0;

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 240,
      height: 300,
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
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    this.window.on('move', () => {
      if (!this.window || this.window.isDestroyed() || this.programmaticMoveDepth > 0) {
        return;
      }

      this.manualBounds = this.window.getBounds();
    });
    this.window.on('closed', () => {
      this.manualBounds = null;
      this.window = null;
    });
    await loadRenderer(this.window, 'shelf');
    return this.window;
  }

  async showNear(
    point: { x: number; y: number },
    inactive = false,
    sizeOverride?: { width: number; height: number },
  ): Promise<void> {
    const window = await this.ensure();
    const width = sizeOverride?.width ?? window.getBounds().width;
    const height = sizeOverride?.height ?? window.getBounds().height;
    const bounds = this.manualBounds ?? computeBounds(point, width, height);
    this.withProgrammaticMove(() => {
      window.setBounds(bounds, false);
    });
    this.showWindow(window, inactive);
  }

  async show(inactive = false): Promise<void> {
    const window = await this.ensure();
    this.showWindow(window, inactive);
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  hide(): void {
    this.window?.closeFilePreview();
    this.window?.hide();
  }

  resetPosition(): void {
    this.manualBounds = null;
  }

  sendState(state: AppState): void {
    this.window?.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  previewFile(path: string, displayName?: string): boolean {
    if (!this.window) {
      return false;
    }

    this.window.previewFile(path, displayName);
    return true;
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window;
  }

  private showWindow(window: BrowserWindow, inactive: boolean): void {
    if (inactive) {
      window.showInactive();
      return;
    }

    window.show();
    window.focus();
  }

  private withProgrammaticMove(callback: () => void): void {
    this.programmaticMoveDepth += 1;
    try {
      callback();
    } finally {
      this.programmaticMoveDepth -= 1;
    }
  }
}

function computeBounds(point: { x: number; y: number }, width: number, height: number) {
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const padding = 16;
  const x = Math.min(Math.max(area.x + padding, point.x - width / 2), area.x + area.width - width - padding);
  const y = Math.min(Math.max(area.y + padding, point.y - 52), area.y + area.height - height - padding);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
  };
}
