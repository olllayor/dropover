import { app, clipboard, dialog, globalShortcut, Menu, ipcMain, nativeImage, screen, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  appStateSchema,
  createShelfInputSchema,
  ingestPayloadSchema,
  preferencePatchSchema,
  type AppState,
  type IngestPayload,
  type ShelfItemRecord,
  type ShelfRecord
} from '@shared/schema'
import { NativeAgentClient, type ShakeDetectedEvent } from './native/nativeAgent'
import { payloadToItems, detectPayloadFromText, getFileBackedPath, isFileBackedItem, refreshFileRef } from './services/payloads'
import { StateStore } from './services/stateStore'
import { PreferencesWindow } from './windows/preferencesWindow'
import { ShelfWindow } from './windows/shelfWindow'
import { TrayController } from './tray'

let stateStore: StateStore
let nativeAgent: NativeAgentClient
let tray: TrayController
let shelfWindow: ShelfWindow
let preferencesWindow: PreferencesWindow

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  app.setName('Ledge')
  Menu.setApplicationMenu(null)

  stateStore = new StateStore(app.getPath('userData'))
  nativeAgent = new NativeAgentClient()
  shelfWindow = new ShelfWindow()
  preferencesWindow = new PreferencesWindow()
  tray = new TrayController({
    onNewShelf: () => {
      void createShelf('tray', currentCursorPoint(), false)
    },
    onOpenPreferences: () => {
      void preferencesWindow.show()
    },
    onRestoreShelf: (id) => {
      void restoreShelf(id)
    },
    onDropFiles: (paths) => {
      void handleExternalPayload({ kind: 'fileDrop', paths }, 'tray')
    },
    onDropText: (text) => {
      void handleExternalPayload(detectPayloadFromText(text), 'tray')
    },
    onQuit: () => {
      app.quit()
    }
  })

  await nativeAgent.start()
  nativeAgent.on('shakeDetected', (event: ShakeDetectedEvent) => {
    void handleShakeDetected(event)
  })

  syncSystemPreferences()
  await nativeAgent.configureGesture(stateStore.getPreferences())
  broadcastState()
  registerIpc()
})

app.on('activate', () => {
  void preferencesWindow.show()
})

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getState, async () => broadcastState())
  ipcMain.handle(IPC_CHANNELS.createShelf, async (_event, input: unknown) => {
    const parsed = createShelfInputSchema.parse(input)
    await createShelf(parsed.reason, currentCursorPoint(), false)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.restoreShelf, async (_event, id: string) => restoreShelf(id))
  ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
    await addPayloadToLiveShelf(ingestPayloadSchema.parse(payload))
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
    stateStore.closeShelf()
    shelfWindow.hide()
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.getPreferences, async () => stateStore.getPreferences())
  ipcMain.handle(IPC_CHANNELS.setPreferences, async (_event, patch: unknown) => {
    stateStore.setPreferences(preferencePatchSchema.parse(patch))
    syncSystemPreferences()
    await nativeAgent.configureGesture(stateStore.getPreferences())
    broadcastState()
    return stateStore.getPreferences()
  })
  ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () => stateStore.getRecentShelves())
  ipcMain.handle(IPC_CHANNELS.getPermissionStatus, async () => ({
    ...nativeAgent.getStatus()
  }))
  ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async () => nativeAgent.openPermissionSettings())
  ipcMain.handle(IPC_CHANNELS.previewItem, async (_event, itemId: string) => previewItem(itemId))
  ipcMain.handle(IPC_CHANNELS.revealItem, async (_event, itemId: string) => revealItem(itemId))
  ipcMain.handle(IPC_CHANNELS.openItem, async (_event, itemId: string) => openItem(itemId))
  ipcMain.handle(IPC_CHANNELS.copyItem, async (_event, itemId: string) => copyItem(itemId))
  ipcMain.handle(IPC_CHANNELS.saveItem, async (_event, itemId: string) => saveItem(itemId))
  ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: string) => {
    stateStore.removeItem(itemId)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, name: string) => {
    stateStore.renameLiveShelf(name)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.clearShelf, async () => {
    stateStore.clearLiveShelf()
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, itemIds: string[]) => {
    stateStore.reorderItems(itemIds)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds?: string[]) => shareItems(itemIds))
  ipcMain.on(IPC_CHANNELS.startItemDrag, (event, itemId: string) => {
    const item = liveShelfItems().find((entry) => entry.id === itemId)
    if (!item || !isFileBackedItem(item)) {
      return
    }

    const path = getFileBackedPath(item)
    if (!path) {
      return
    }

    event.sender.startDrag({
      file: path,
      icon: dragIconImage()
    })
  })
}

async function handleExternalPayload(payload: IngestPayload, reason: ShelfRecord['origin']): Promise<void> {
  await createShelf(reason, currentCursorPoint(), reason === 'tray')
  await addPayloadToLiveShelf(payload)
}

async function handleShakeDetected(event: ShakeDetectedEvent): Promise<void> {
  const preferences = stateStore.getPreferences()
  if (!preferences.shakeEnabled) {
    return
  }

  if (event.sourceBundleId && preferences.excludedBundleIds.includes(event.sourceBundleId)) {
    return
  }

  await createShelf('shake', { x: event.x, y: event.y }, true)
}

async function createShelf(
  reason: ShelfRecord['origin'],
  point: { x: number; y: number },
  inactive: boolean
): Promise<void> {
  const liveShelf = stateStore.getLiveShelf()
  if (!liveShelf) {
    stateStore.createShelf(reason)
  }

  await shelfWindow.showNear(point, inactive)
  broadcastState()
}

async function restoreShelf(id: string): Promise<AppState> {
  const shelf = stateStore.restoreShelf(id)
  if (!shelf) {
    return broadcastState()
  }

  const refreshedItems = await Promise.all(
    shelf.items.map(async (item) => {
      if (!isFileBackedItem(item)) {
        return item
      }

      return {
        ...item,
        file: await refreshFileRef(item.file, {
          resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath)
        })
      }
    })
  )

  stateStore.replaceLiveShelf({
    ...shelf,
    items: refreshedItems
  })

  await shelfWindow.showNear(currentCursorPoint(), false)
  return broadcastState()
}

async function addPayloadToLiveShelf(payload: IngestPayload): Promise<void> {
  const items = await payloadToItems(payload, {
    assetsDir: stateStore.assetsDir,
    createBookmark: (path) => nativeAgent.createBookmark(path),
    resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath)
  })
  stateStore.ensureLiveShelf('manual')
  stateStore.appendItems(items)
  await shelfWindow.showNear(currentCursorPoint(), false)
  broadcastState()
}

function syncSystemPreferences(): void {
  const preferences = stateStore.getPreferences()
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: preferences.launchAtLogin
      })
    } catch {
      // Some macOS environments can still reject login-item writes.
    }
  }
  globalShortcut.unregisterAll()
  if (preferences.globalShortcut) {
    globalShortcut.register(preferences.globalShortcut, () => {
      void createShelf('shortcut', currentCursorPoint(), false)
    })
  }
}

function broadcastState(): AppState {
  const state = appStateSchema.parse(stateStore.snapshot(nativeAgent.getStatus()))
  tray.update(state)
  shelfWindow.sendState(state)
  preferencesWindow.sendState(state)
  return state
}

function liveShelfItems(): ShelfItemRecord[] {
  return stateStore.getLiveShelf()?.items ?? []
}

async function previewItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item || !isFileBackedItem(item)) {
    return false
  }

  const path = getFileBackedPath(item)
  if (!path) {
    return false
  }

  return shelfWindow.previewFile(path, basename(path))
}

async function revealItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  const path = item && isFileBackedItem(item) ? getFileBackedPath(item) : null
  if (!path) {
    return false
  }

  shell.showItemInFolder(path)
  return true
}

async function openItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item) {
    return false
  }

  if (item.kind === 'url') {
    await shell.openExternal(item.url)
    return true
  }

  const path =
    isFileBackedItem(item)
      ? getFileBackedPath(item)
      : item.kind === 'text'
        ? item.savedFilePath ?? null
        : null

  if (!path) {
    return false
  }

  await shell.openPath(path)
  return true
}

async function copyItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item) {
    return false
  }

  if (item.kind === 'text') {
    clipboard.writeText(item.text)
    return true
  }

  if (item.kind === 'url') {
    clipboard.writeText(item.url)
    return true
  }

  return false
}

async function saveItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item || (item.kind !== 'text' && item.kind !== 'url')) {
    return false
  }

  const extension = item.kind === 'url' ? 'webloc' : 'txt'
  const window = shelfWindow.getBrowserWindow()
  const options = {
    defaultPath: join(stateStore.exportsDir, `${sanitizeName(item.title)}.${extension}`)
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return false
  }

  if (item.kind === 'text') {
    await fs.writeFile(result.filePath, item.text, 'utf8')
  } else {
    const data = urlToWebloc(item.url)
    await fs.writeFile(result.filePath, data, 'utf8')
  }

  return true
}

async function shareItems(itemIds?: string[]): Promise<boolean> {
  const liveShelf = stateStore.getLiveShelf()
  if (!liveShelf) {
    return false
  }

  const selection = (itemIds?.length ? liveShelf.items.filter((item) => itemIds.includes(item.id)) : liveShelf.items)
    .filter(isFileBackedItem)
    .map((item) => getFileBackedPath(item))
    .filter((path): path is string => Boolean(path))

  if (selection.length === 0) {
    return false
  }

  const menu = Menu.buildFromTemplate([
    {
      role: 'shareMenu',
      sharingItem: {
        filePaths: selection
      }
    }
  ])

  menu.popup({
    window: shelfWindow.getBrowserWindow() ?? undefined
  })
  return true
}

function currentCursorPoint() {
  return screen.getCursorScreenPoint()
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-item'
}

function urlToWebloc(url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>URL</key>\n  <string>${url}</string>\n</dict>\n</plist>\n`
}

function dragIconImage() {
  const svg = `
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="14" width="48" height="36" rx="12" fill="#16120F" opacity="0.92"/>
      <rect x="14" y="20" width="36" height="8" rx="4" fill="#F4E7D2"/>
      <rect x="14" y="33" width="24" height="6" rx="3" fill="#D6C3AA"/>
    </svg>
  `

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}
