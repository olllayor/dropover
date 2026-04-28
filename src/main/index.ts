import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  ipcMain,
  nativeImage,
  net,
  protocol as protocolModule,
  screen,
  shell,
} from 'electron';
import { promises as fs } from 'node:fs';
import { basename, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  appStateSchema,
  createShelfInputSchema,
  ingestPayloadSchema,
  permissionStatusSchema,
  preferencePatchSchema,
  type AppState,
  type IngestPayload,
  type PermissionStatus,
  type ShelfItemRecord,
  type ShelfRecord,
} from '@shared/schema';
import { normalizeExcludedBundleIds } from '@shared/preferences';
import { NativeAgentClient, type ShakeDetectedEvent } from './native/nativeAgent';
import {
  payloadToItems,
  detectPayloadFromText,
  getFileBackedPath,
  isFileBackedItem,
  refreshFileRef,
} from './services/payloads';
import {
  isOpenPathSuccess,
  normalizeGlobalShortcut,
  urlToWebloc,
  validateGlobalShortcut,
} from './services/systemUtils';
import { StateStore } from './services/stateStore';
import { PreferencesWindow } from './windows/preferencesWindow';
import { ShelfWindow } from './windows/shelfWindow';
import { TrayController } from './tray';

let stateStore: StateStore;
let nativeAgent: NativeAgentClient;
let tray: TrayController;
let shelfWindow: ShelfWindow;
let preferencesWindow: PreferencesWindow;
let shortcutStatus: Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> = {
  shortcutRegistered: false,
  shortcutError: '',
};
const PROJECT_URL = 'https://github.com/olllayor/ledge';
const WHATS_NEW_URL = `${PROJECT_URL}/releases`;
const QUICK_START_URL = `${PROJECT_URL}#readme`;
const ASSET_PROTOCOL = 'ledge-asset';

protocolModule.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  app.setName('Ledge');
  Menu.setApplicationMenu(null);
  protocolModule.handle(ASSET_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');

    if (!path) {
      return new Response('Missing asset path.', { status: 400 });
    }

    const allowedPath = resolveAllowedAssetPath(path);
    if (!allowedPath) {
      return new Response('Asset path is not allowed.', { status: 403 });
    }

    return net.fetch(pathToFileURL(allowedPath).toString());
  });

  stateStore = new StateStore(app.getPath('userData'));
  nativeAgent = new NativeAgentClient();
  shelfWindow = new ShelfWindow();
  preferencesWindow = new PreferencesWindow();
  tray = new TrayController({
    onNewShelf: () => {
      void createShelf('tray', currentCursorPoint(), false);
    },
    onNewShelfFromClipboard: () => {
      void createShelfFromClipboard();
    },
    onOpenPreferences: () => {
      void preferencesWindow.show();
    },
    onOpenWhatsNew: () => {
      void shell.openExternal(WHATS_NEW_URL);
    },
    onOpenQuickStart: () => {
      void shell.openExternal(QUICK_START_URL);
    },
    onOpenAbout: () => {
      app.showAboutPanel();
    },
    onRestoreShelf: (id) => {
      void restoreShelf(id);
    },
    onDropFiles: (paths) => {
      void handleExternalPayload({ kind: 'fileDrop', paths }, 'tray');
    },
    onDropText: (text) => {
      void handleExternalPayload(detectPayloadFromText(text), 'tray');
    },
    onQuit: () => {
      app.quit();
    },
  });

  nativeAgent.on('statusChanged', () => {
    broadcastState();
  });
  await nativeAgent.start();
  nativeAgent.on('shakeDetected', (event: ShakeDetectedEvent) => {
    void handleShakeDetected(event);
  });

  syncSystemPreferences();
  await nativeAgent.configureGesture(stateStore.getPreferences());
  broadcastState();
  registerIpc();
});

app.on('activate', () => {
  void preferencesWindow.show();
});

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getState, async () => broadcastState());
  ipcMain.handle(IPC_CHANNELS.createShelf, async (_event, input: unknown) => {
    const parsed = createShelfInputSchema.parse(input);
    await createShelf(parsed.reason, currentCursorPoint(), false);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.restoreShelf, async (_event, id: string) => restoreShelf(id));
  ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
    await addPayloadToLiveShelf(ingestPayloadSchema.parse(payload));
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
    stateStore.closeShelf();
    shelfWindow.resetPosition();
    shelfWindow.hide();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.getPreferences, async () => stateStore.getPreferences());
  ipcMain.handle(IPC_CHANNELS.setPreferences, async (_event, patch: unknown) => {
    stateStore.setPreferences(normalizePreferencePatch(preferencePatchSchema.parse(patch)));
    syncSystemPreferences();
    await nativeAgent.configureGesture(stateStore.getPreferences());
    broadcastState();
    return stateStore.getPreferences();
  });
  ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () => stateStore.getRecentShelves());
  ipcMain.handle(IPC_CHANNELS.getPermissionStatus, async () => currentPermissionStatus());
  ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async () => nativeAgent.openPermissionSettings());
  ipcMain.handle(IPC_CHANNELS.previewItem, async (_event, itemId: string) => previewItem(itemId));
  ipcMain.handle(IPC_CHANNELS.revealItem, async (_event, itemId: string) => revealItem(itemId));
  ipcMain.handle(IPC_CHANNELS.openItem, async (_event, itemId: string) => openItem(itemId));
  ipcMain.handle(IPC_CHANNELS.copyItem, async (_event, itemId: string) => copyItem(itemId));
  ipcMain.handle(IPC_CHANNELS.saveItem, async (_event, itemId: string) => saveItem(itemId));
  ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: string) => {
    stateStore.removeItem(itemId);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, name: string) => {
    stateStore.renameLiveShelf(name);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.clearShelf, async () => {
    stateStore.clearLiveShelf();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, itemIds: string[]) => {
    stateStore.reorderItems(itemIds);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds?: string[]) => shareItems(itemIds));
  ipcMain.handle(IPC_CHANNELS.showItemContextMenu, async (_event, itemId: string) => {
    const item = liveShelfItems().find((i) => i.id === itemId);
    if (!item) return false;

    const missing = isFileBackedItem(item) && item.file.isMissing;
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (isFileBackedItem(item)) {
      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => previewItem(item.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => revealItem(item.id) },
        { label: 'Open', enabled: !missing, click: () => openItem(item.id) },
        { type: 'separator' },
        { label: 'Share', enabled: true, click: () => shareItems([item.id]) },
      );
    } else if (item.kind === 'text' || item.kind === 'url') {
      template.push(
        { label: 'Copy', click: () => copyItem(item.id) },
        { label: 'Save', click: () => saveItem(item.id) },
      );
      if (item.kind === 'url') {
        template.push({ label: 'Open', click: () => openItem(item.id) });
      }
    }

    template.push(
      { type: 'separator' },
      {
        label: 'Remove Item',
        click: () => {
          stateStore.removeItem(item.id);
          broadcastState();
        },
      },
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: shelfWindow.getBrowserWindow() ?? undefined });
    return true;
  });
  ipcMain.on(IPC_CHANNELS.startItemDrag, (event, itemId: string) => {
    const paths = draggablePathsForItemIds([itemId]);
    console.info('[DragDebug][Main] startItemDrag request.', {
      itemId,
      pathCount: paths.length,
      firstPath: paths[0] ?? null,
    });

    if (paths.length === 0) {
      console.warn('[Drag] No draggable paths found for item:', itemId);
      event.returnValue = false;
      return;
    }

    try {
      startNativeDrag(event.sender, paths);
      event.returnValue = true;
      console.info('[DragDebug][Main] startItemDrag succeeded.', {
        itemId,
        pathCount: paths.length,
      });
    } catch (error) {
      console.error('[DragDebug][Main] startItemDrag failed.', {
        itemId,
        error: error instanceof Error ? error.message : String(error),
      });
      event.returnValue = false;
    }
  });
  ipcMain.on(IPC_CHANNELS.startItemsDrag, (event, itemIds: string[]) => {
    const paths = draggablePathsForItemIds(itemIds);
    console.info('[DragDebug][Main] startItemsDrag request.', {
      itemIds,
      pathCount: paths.length,
      pathsPreview: paths.slice(0, 3),
    });

    if (paths.length === 0) {
      console.warn('[Drag] No draggable paths found for items:', itemIds);
      event.returnValue = false;
      return;
    }

    try {
      startNativeDrag(event.sender, paths);
      event.returnValue = true;
      console.info('[DragDebug][Main] startItemsDrag succeeded.', {
        itemCount: itemIds.length,
        pathCount: paths.length,
      });
    } catch (error) {
      console.error('[DragDebug][Main] startItemsDrag failed.', {
        itemIds,
        error: error instanceof Error ? error.message : String(error),
      });
      event.returnValue = false;
    }
  });
}

async function handleExternalPayload(payload: IngestPayload, reason: ShelfRecord['origin']): Promise<void> {
  const point = currentCursorPoint();
  await addPayloadToLiveShelf(payload, {
    origin: reason,
    point,
    inactive: reason === 'tray',
  });
}

async function createShelfFromClipboard(): Promise<void> {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    await handleExternalPayload(
      {
        kind: 'image',
        mimeType: 'image/png',
        base64: image.toPNG().toString('base64'),
        filenameHint: 'clipboard-image',
      },
      'tray',
    );
    return;
  }

  const text = clipboard.readText().trim();
  if (text) {
    await handleExternalPayload(detectPayloadFromText(text), 'tray');
    return;
  }

  await createShelf('tray', currentCursorPoint(), false);
}

async function handleShakeDetected(event: ShakeDetectedEvent): Promise<void> {
  const preferences = stateStore.getPreferences();
  if (!preferences.shakeEnabled) {
    return;
  }

  if (event.sourceBundleId && preferences.excludedBundleIds.includes(event.sourceBundleId)) {
    return;
  }

  // Electron already reports the cursor in the coordinate space used by BrowserWindow.
  // Using it here avoids AppKit-to-Electron translation errors on multi-display setups.
  await createShelf('shake', currentCursorPoint(), true);
}

async function createShelf(
  reason: ShelfRecord['origin'],
  point: { x: number; y: number },
  inactive: boolean,
): Promise<void> {
  const liveShelf = stateStore.getLiveShelf();
  if (!liveShelf) {
    stateStore.createShelf(reason);
    shelfWindow.resetPosition();
  }

  const isShake = reason === 'shake';
  await shelfWindow.showNear(point, inactive, isShake ? { width: 240, height: 296 } : undefined);
  broadcastState();
}

async function restoreShelf(id: string): Promise<AppState> {
  const shelf = stateStore.restoreShelf(id);
  if (!shelf) {
    return broadcastState();
  }

  const refreshedItems = await Promise.all(
    shelf.items.map(async (item) => {
      if (!isFileBackedItem(item)) {
        return item;
      }

      return {
        ...item,
        file: await refreshFileRef(item.file, {
          resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
        }),
      };
    }),
  );

  stateStore.replaceLiveShelf({
    ...shelf,
    items: refreshedItems,
  });

  shelfWindow.resetPosition();
  await shelfWindow.showNear(currentCursorPoint(), false);
  return broadcastState();
}

async function addPayloadToLiveShelf(
  payload: IngestPayload,
  options: {
    origin?: ShelfRecord['origin'];
    point?: { x: number; y: number };
    inactive?: boolean;
  } = {},
): Promise<boolean> {
  const items = await payloadToItems(payload, {
    assetsDir: stateStore.assetsDir,
    createBookmark: (path) => nativeAgent.createBookmark(path),
    resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
  });

  if (items.length === 0) {
    return false;
  }

  stateStore.ensureLiveShelf(options.origin ?? 'manual');
  stateStore.appendItems(items);
  if (shelfWindow.isVisible()) {
    await shelfWindow.show(options.inactive ?? false);
  } else {
    await shelfWindow.showNear(options.point ?? currentCursorPoint(), options.inactive ?? false);
  }
  broadcastState();
  return true;
}

function syncSystemPreferences(): void {
  let preferences = stateStore.getPreferences();
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: preferences.launchAtLogin,
      });
    } catch {
      // Some macOS environments can still reject login-item writes.
    }
  }
  globalShortcut.unregisterAll();
  shortcutStatus = {
    shortcutRegistered: false,
    shortcutError: '',
  };

  const normalizedShortcut = normalizeGlobalShortcut(preferences.globalShortcut);
  if (normalizedShortcut !== preferences.globalShortcut) {
    preferences = stateStore.setPreferences({
      globalShortcut: normalizedShortcut,
    });
  }

  if (!normalizedShortcut) {
    return;
  }

  const shortcutError = validateGlobalShortcut(normalizedShortcut);
  if (shortcutError) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError,
    };
    return;
  }

  try {
    const registered = globalShortcut.register(normalizedShortcut, () => {
      void createShelf('shortcut', currentCursorPoint(), false);
    });

    shortcutStatus = registered
      ? {
          shortcutRegistered: true,
          shortcutError: '',
        }
      : {
          shortcutRegistered: false,
          shortcutError: 'Shortcut could not be registered. It may already be in use.',
        };
  } catch (error) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError: error instanceof Error ? error.message : 'Shortcut could not be registered.',
    };
  }
}

function broadcastState(): AppState {
  const state = appStateSchema.parse(stateStore.snapshot(currentPermissionStatus()));
  tray.update(state);
  shelfWindow.sendState(state);
  preferencesWindow.sendState(state);
  return state;
}

function liveShelfItems(): ShelfItemRecord[] {
  return stateStore.getLiveShelf()?.items ?? [];
}

async function previewItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item || !isFileBackedItem(item)) {
    return false;
  }

  const path = getFileBackedPath(item);
  if (!path) {
    return false;
  }

  return shelfWindow.previewFile(path, basename(path));
}

async function revealItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  const path = item && isFileBackedItem(item) ? getFileBackedPath(item) : null;
  if (!path) {
    return false;
  }

  shell.showItemInFolder(path);
  return true;
}

async function openItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item) {
    return false;
  }

  if (item.kind === 'url') {
    await shell.openExternal(item.url);
    return true;
  }

  const path = isFileBackedItem(item)
    ? getFileBackedPath(item)
    : item.kind === 'text'
      ? (item.savedFilePath ?? null)
      : null;

  if (!path) {
    return false;
  }

  return isOpenPathSuccess(await shell.openPath(path));
}

async function copyItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item) {
    return false;
  }

  if (item.kind === 'text') {
    clipboard.writeText(item.text);
    return true;
  }

  if (item.kind === 'url') {
    clipboard.writeText(item.url);
    return true;
  }

  if (isFileBackedItem(item)) {
    const filePath = getFileBackedPath(item);
    if (filePath) {
      writeFilePathsToClipboard([filePath]);
      return true;
    }
  }

  return false;
}

async function saveItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item || (item.kind !== 'text' && item.kind !== 'url')) {
    return false;
  }

  const extension = item.kind === 'url' ? 'webloc' : 'txt';
  const window = shelfWindow.getBrowserWindow();
  const options = {
    defaultPath: join(stateStore.exportsDir, `${sanitizeName(item.title)}.${extension}`),
  };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return false;
  }

  if (item.kind === 'text') {
    await fs.writeFile(result.filePath, item.text, 'utf8');
  } else {
    const data = urlToWebloc(item.url);
    await fs.writeFile(result.filePath, data, 'utf8');
  }

  return true;
}

async function shareItems(itemIds?: string[]): Promise<boolean> {
  const liveShelf = stateStore.getLiveShelf();
  if (!liveShelf) {
    return false;
  }

  const selection = (itemIds?.length ? liveShelf.items.filter((item) => itemIds.includes(item.id)) : liveShelf.items)
    .filter(isFileBackedItem)
    .map((item) => getFileBackedPath(item))
    .filter((path): path is string => Boolean(path));

  if (selection.length === 0) {
    return false;
  }

  const menu = Menu.buildFromTemplate([
    {
      role: 'shareMenu',
      sharingItem: {
        filePaths: selection,
      },
    },
  ]);

  menu.popup({
    window: shelfWindow.getBrowserWindow() ?? undefined,
  });
  return true;
}

function currentCursorPoint() {
  return screen.getCursorScreenPoint();
}

function currentPermissionStatus(): PermissionStatus {
  return permissionStatusSchema.parse({
    ...nativeAgent.getStatus(),
    ...shortcutStatus,
  });
}

function resolveAllowedAssetPath(path: string): string | null {
  if (!isAbsolute(path)) {
    return null;
  }

  const normalizedPath = resolvePath(path);
  if (isPathInside(stateStore.assetsDir, normalizedPath)) {
    return normalizedPath;
  }

  for (const item of liveShelfItems()) {
    if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
      continue;
    }

    const itemPath = getFileBackedPath(item);
    if (itemPath && resolvePath(itemPath) === normalizedPath) {
      return normalizedPath;
    }
  }

  return null;
}

function isPathInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolvePath(parent);
  const normalizedCandidate = resolvePath(candidate);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${sep}`);
}

function writeFilePathsToClipboard(paths: string[]): void {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return;
  }

  const uriList = uniquePaths.map((path) => pathToFileURL(path).toString()).join('\r\n');
  clipboard.clear();
  clipboard.writeText(uniquePaths.join('\n'));
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList, 'utf8'));
}

function normalizePreferencePatch(patch: ReturnType<typeof preferencePatchSchema.parse>) {
  let nextPatch = patch;

  if (patch.globalShortcut !== undefined) {
    nextPatch = {
      ...nextPatch,
      globalShortcut: normalizeGlobalShortcut(patch.globalShortcut),
    };
  }

  if (patch.excludedBundleIds !== undefined) {
    const { normalized, invalid } = normalizeExcludedBundleIds(patch.excludedBundleIds);
    if (invalid.length > 0) {
      throw new Error(
        invalid.length === 1
          ? `Invalid macOS bundle identifier: ${invalid[0]}`
          : `Invalid macOS bundle identifiers: ${invalid.join(', ')}`,
      );
    }

    nextPatch = {
      ...nextPatch,
      excludedBundleIds: normalized,
    };
  }

  return nextPatch;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-item';
}

function draggablePathsForItemIds(itemIds: string[]): string[] {
  if (itemIds.length === 0) {
    return [];
  }

  const ids = new Set(itemIds);
  const paths: string[] = [];

  for (const entry of liveShelfItems()) {
    if (!ids.has(entry.id) || !isFileBackedItem(entry)) {
      continue;
    }

    const path = getFileBackedPath(entry);
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}

function startNativeDrag(webContents: Electron.WebContents, paths: string[]): void {
  const [firstPath] = paths;
  if (!firstPath) {
    console.warn('[DragDebug][Main] startNativeDrag aborted: no firstPath.', {
      pathCount: paths.length,
    });
    return;
  }

  console.info('[DragDebug][Main] startNativeDrag begin.', {
    webContentsId: webContents.id,
    pathCount: paths.length,
    firstPath,
  });

  const icon = dragIconImage(paths);
  console.info('[DragDebug][Main] drag icon prepared.', {
    isEmpty: icon.isEmpty(),
    size: icon.getSize(),
  });

  const dragPayload =
    paths.length > 1
      ? {
          file: firstPath,
          files: paths,
          icon,
        }
      : {
          file: firstPath,
          icon,
        };

  console.info('[DragDebug][Main] invoking webContents.startDrag.', {
    hasFilesArray: 'files' in dragPayload,
    payloadFile: dragPayload.file,
    payloadFileCount: paths.length,
  });

  webContents.startDrag(dragPayload);

  console.info('[DragDebug][Main] webContents.startDrag returned normally.');
}

function dragIconImage(paths: string[]) {
  const iconCandidates = [
    ...paths,
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ];

  for (const candidate of iconCandidates) {
    const image = nativeImage.createFromPath(candidate);
    if (image.isEmpty()) {
      continue;
    }

    return image.resize({ width: 72, height: 72, quality: 'best' });
  }

  const embeddedFallback = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+P+/HgAEtQJ8j3u7EwAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  if (!embeddedFallback.isEmpty()) {
    return embeddedFallback.resize({ width: 72, height: 72, quality: 'best' });
  }

  return nativeImage.createEmpty();
}
