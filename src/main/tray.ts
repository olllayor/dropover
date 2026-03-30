import { Menu, Tray, nativeImage } from 'electron'
import type { AppState, ShelfRecord } from '@shared/schema'

interface TrayCallbacks {
  onNewShelf(): void
  onNewShelfFromClipboard(): void
  onOpenPreferences(): void
  onOpenWhatsNew(): void
  onOpenQuickStart(): void
  onOpenAbout(): void
  onRestoreShelf(id: string): void
  onDropFiles(paths: string[]): void
  onDropText(text: string): void
  onQuit(): void
}

export class TrayController {
  private readonly tray: Tray
  private snapshot: AppState | null = null

  constructor(private readonly callbacks: TrayCallbacks) {
    this.tray = new Tray(createTrayImage())
    this.tray.setIgnoreDoubleClickEvents(true)
    this.tray.setToolTip('Ledge')
    this.tray.on('click', () => {
      this.tray.popUpContextMenu(this.buildMenu())
    })
    this.tray.on('drop-files', (_event, files) => {
      this.callbacks.onDropFiles(files)
    })
    this.tray.on('drop-text', (_event, text) => {
      this.callbacks.onDropText(text)
    })
  }

  update(snapshot: AppState): void {
    this.snapshot = snapshot
  }

  destroy(): void {
    this.tray.destroy()
  }

  private buildMenu(): Menu {
    const recentShelves = this.snapshot?.recentShelves ?? []

    return Menu.buildFromTemplate([
      {
        label: 'New Shelf',
        click: () => this.callbacks.onNewShelf()
      },
      {
        label: 'New Shelf From Clipboard',
        click: () => this.callbacks.onNewShelfFromClipboard()
      },
      {
        label: 'Recent Shelves',
        submenu: recentShelves.length > 0 ? recentShelves.map((shelf) => createRestoreMenuItem(shelf, this.callbacks.onRestoreShelf)) : [{ label: 'No recent shelves', enabled: false }]
      },
      {
        type: 'separator'
      },
      {
        label: `Version ${process.env.npm_package_version ?? '0.1.0'}`,
        enabled: false
      },
      {
        label: 'New in This Version…',
        click: () => this.callbacks.onOpenWhatsNew()
      },
      {
        label: 'Quick Start Guide…',
        click: () => this.callbacks.onOpenQuickStart()
      },
      {
        label: 'About Ledge…',
        click: () => this.callbacks.onOpenAbout()
      },
      {
        label: 'Settings…',
        accelerator: 'CommandOrControl+,',
        click: () => this.callbacks.onOpenPreferences()
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => this.callbacks.onQuit()
      }
    ])
  }
}

function createRestoreMenuItem(shelf: ShelfRecord, onRestore: (id: string) => void) {
  return {
    label: `${shelf.name} (${shelf.items.length})`,
    click: () => onRestore(shelf.id)
  }
}

function createTrayImage() {
  const svg = `
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.2" y="9.8" width="13.6" height="3.1" rx="1.55" fill="black"/>
      <rect x="5.3" y="4.1" width="7.4" height="4.9" rx="1.8" fill="black"/>
      <rect x="6.7" y="5.5" width="4.6" height="0.95" rx="0.475" fill="white"/>
      <rect x="6.25" y="10.9" width="5.5" height="0.95" rx="0.475" fill="white"/>
    </svg>
  `

  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  image.setTemplateImage(true)
  return image
}
