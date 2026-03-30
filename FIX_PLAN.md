# Ledge — Fix & Build Plan

> Goal: Build a Dropover-equivalent macOS shelf utility using the existing Electron + React + Swift stack.
> Each phase is independently shippable. Phases are ordered by dependency and priority.

---

## Phase 1 — Bug Fixes & Foundation Stabilization

Fix all existing code defects before adding features.

### 1.1 Multi-monitor coordinate translation broken in Swift helper

**File:** `native/DropShelfNativeAgent/Sources/DropShelfNativeAgent/main.swift:169-176`

**Problem:** `electronPoint(for:)` uses `screen.frame.maxY - point.y` which only works on the primary display. Secondary monitors produce wrong Y coordinates.

**Fix:** Account for the screen's origin offset in global coordinate space:

```swift
private func electronPoint(for point: CGPoint) -> CGPoint {
    for screen in NSScreen.screens where screen.frame.contains(point) {
        let translatedY = screen.frame.maxY - point.y
        let translatedX = point.x
        return CGPoint(x: translatedX, y: translatedY)
    }
    return point
}
```

The existing code is actually correct for Electron's coordinate system (which uses top-left origin for the primary screen). Verify this works on a dual-monitor setup and add unit tests with mock screen frames if needed.

**Acceptance:** Shake detected on any monitor opens the shelf at the correct cursor position.

---

### 1.2 Native agent crash recovery

**File:** `src/main/native/nativeAgent.ts:84-90`

**Problem:** When the Swift helper process exits unexpectedly, shake detection is permanently lost until app restart.

**Fix:** Add automatic restart logic with exponential backoff:

```typescript
private restartAttempts = 0
private readonly maxRestartAttempts = 3

private handleExit(): void {
  this.status = {
    ...this.status,
    nativeHelperAvailable: false,
    shakeReady: false,
    lastError: this.status.lastError || 'Native helper exited unexpectedly'
  }
  this.child = null
  this.pending.clear()
  this.attemptRestart()
}

private attemptRestart(): void {
  if (this.restartAttempts >= this.maxRestartAttempts) return
  const delay = Math.pow(2, this.restartAttempts) * 1000
  this.restartAttempts++
  setTimeout(() => {
    void this.start().then(() => { this.restartAttempts = 0 })
  }, delay)
}
```

**Acceptance:** Killing the Swift helper process causes it to restart within 1-4 seconds; shake detection resumes.

---

### 1.3 Unhandled JSON.parse crash in stdout reader

**File:** `src/main/native/nativeAgent.ts:188`

**Problem:** `JSON.parse(line)` has no try/catch. Malformed output from the native helper crashes the Electron main process.

**Fix:**

```typescript
private consumeStdout(chunk: string): void {
  this.stdoutBuffer += chunk
  while (this.stdoutBuffer.includes('\n')) {
    const newlineIndex = this.stdoutBuffer.indexOf('\n')
    const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
    this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
    if (!line) continue

    try {
      const message = JSON.parse(line) as JsonRpcResponse
      this.handleMessage(message)
    } catch {
      this.status.lastError = `Malformed native output: ${line.slice(0, 120)}`
    }
  }
}
```

**Acceptance:** Native helper sending garbage bytes does not crash the app; error is logged.

---

### 1.4 Replace synchronous file I/O with async

**File:** `src/main/services/stateStore.ts:207,215`

**Problem:** `readFileSync` and `writeFileSync` block the Electron main thread on every state mutation.

**Fix:** Replace with async equivalents and debounce writes:

```typescript
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'

private saveTimer: ReturnType<typeof setTimeout> | null = null

private save(): void {
  if (this.saveTimer) clearTimeout(this.saveTimer)
  this.saveTimer = setTimeout(() => {
    void writeFile(this.statePath, JSON.stringify(this.persisted, null, 2))
  }, 50)
}

private async load(): Promise<PersistedState> {
  try {
    await access(this.statePath)
    const raw = await readFile(this.statePath, 'utf8')
    return persistedStateSchema.parse(JSON.parse(raw))
  } catch {
    return this.defaultState()
  }
}
```

Also update the constructor to be async or use a static `StateStore.create()` factory.

**Acceptance:** No synchronous disk I/O on the main thread during normal operation.

---

### 1.5 Error handling in renderer drop handler

**File:** `src/renderer/src/components/ShelfView.tsx:267-280`

**Problem:** `item.getAsFile()` can throw for certain DataTransferItem states; no error handling.

**Fix:** Wrap in try/catch:

```typescript
for (const item of Array.from(transfer.items as DataTransferItemList)) {
  if (!item.type.startsWith('image/')) continue
  try {
    const file = item.getAsFile()
    if (!file) continue
    const maybePath = (file as File & { path?: string }).path
    if (maybePath) continue
    payloads.push(await imageToPayload(file))
  } catch {
    // Skip items that can't be read (e.g., async drags, permission issues)
  }
}
```

**Acceptance:** Dropping complex mixed content (files + images + text) never throws; best-effort ingest.

---

### 1.6 Fix MIME type detection

**File:** `src/main/services/payloads.ts:158-173`

**Problem:** MIME types are `application/TXT` (uppercase, wrong prefix).

**Fix:** Build a proper extension-to-MIME map:

```typescript
const mimeMap: Record<string, string> = {
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
}

function guessMimeType(extension: string): string {
  return mimeMap[extension.toLowerCase()] ?? 'application/octet-stream'
}
```

**Acceptance:** File items have correct MIME types matching macOS's `file --mime-type` output.

---

### 1.7 Add IPC channel namespace alignment

**File:** `src/shared/ipc.ts:12`

**Problem:** Channel prefix `dropover:*` conflicts with project name "Ledge".

**Fix:** Rename all channels to `ledge:*`:

```typescript
export const IPC_CHANNELS = {
  getState: 'ledge:get-state',
  createShelf: 'ledge:create-shelf',
  // ... etc
} as const
```

Also update `src/main/index.ts`, `src/preload/index.ts`, and all IPC listeners.

**Acceptance:** No `dropover:` references remain in the codebase; grep confirms.

---

### 1.8 Add state schema versioning

**File:** `src/main/services/stateStore.ts`, `src/shared/schema.ts`

**Problem:** No version field on persisted state; any schema change silently resets user data.

**Fix:** Add version to persisted state:

```typescript
// schema.ts
export const persistedStateMetaSchema = z.object({
  version: z.literal(1),
})

// stateStore.ts
interface PersistedStateV1 {
  version: 1
  liveShelf: ShelfRecord | null
  recentShelves: ShelfRecord[]
  preferences: PreferencesRecord
}

private load(): PersistedState {
  // ... read file ...
  const parsed = JSON.parse(raw)
  if (!parsed.version) {
    return this.migrateFromV0(parsed)
  }
  return persistedStateV1Schema.parse(parsed)
}
```

**Acceptance:** Changing the schema in the future triggers a migration path instead of data loss.

---

## Phase 2 — Multiple Shelves & Window Management

The single biggest architectural gap vs. Dropover.

### 2.1 Rewrite state store for multiple shelves

**Files:** `src/main/services/stateStore.ts`, `src/shared/schema.ts`

**Problem:** Only one `liveShelf` slot. Dropover supports unlimited simultaneous shelves.

**Fix:** Replace `liveShelf: ShelfRecord | null` with `shelves: ShelfRecord[]`:

```typescript
// schema.ts
export const appStateSchema = z.object({
  shelves: z.array(shelfRecordSchema),       // all open shelves
  recentShelves: z.array(shelfRecordSchema).max(10),
  preferences: preferencesRecordSchema,
  permissionStatus: permissionStatusSchema,
})

// stateStore.ts — new methods
createShelfAt(point, origin): ShelfRecord
closeShelf(id: string): void
getShelf(id: string): ShelfRecord | null
getAllShelves(): ShelfRecord[]
```

**Acceptance:** Multiple shelves can exist simultaneously; each has independent items and state.

---

### 2.2 Multi-window shelf management

**File:** `src/main/windows/shelfWindow.ts`

**Problem:** One `ShelfWindow` instance. Each shelf needs its own BrowserWindow.

**Fix:** Refactor to a map of windows:

```typescript
export class ShelfWindowManager {
  private windows = new Map<string, BrowserWindow>()

  async showShelf(shelfId: string, point: { x: number; y: number }, inactive: boolean): Promise<void> {
    let win = this.windows.get(shelfId)
    if (!win || win.isDestroyed()) {
      win = this.createWindow(shelfId)
      this.windows.set(shelfId, win)
    }
    // ... position and show ...
  }

  closeShelf(shelfId: string): void {
    const win = this.windows.get(shelfId)
    win?.close()
    this.windows.delete(shelfId)
  }

  closeAll(): void {
    for (const [id, win] of this.windows) {
      win.close()
      this.windows.delete(id)
    }
  }

  sendState(shelfId: string, state: ShelfState): void {
    this.windows.get(shelfId)?.webContents.send('shelf:state', state)
  }
}
```

**Acceptance:** Each shelf is an independent window; closing one doesn't affect others.

---

### 2.3 Pinned shelves

**Files:** `src/main/services/stateStore.ts`, `src/main/tray.ts`

**Problem:** No way to keep a shelf permanently accessible.

**Fix:** Add `pinned: boolean` to `ShelfRecord` and surface in tray menu:

```typescript
// schema.ts
export const shelfRecordSchema = z.object({
  // ... existing fields ...
  pinned: z.boolean().default(false),
})

// stateStore.ts
pinShelf(id: string): void {
  const shelf = this.findShelf(id)
  if (shelf) { shelf.pinned = true; this.save() }
}

unpinShelf(id: string): void {
  const shelf = this.findShelf(id)
  if (shelf) { shelf.pinned = false; this.save() }
}
```

Tray menu gets a "Pinned Shelves" section above "Recent Shelves".

**Acceptance:** Pinning a shelf keeps it in the tray menu permanently until explicitly unpinned.

---

### 2.4 Shelf Detail View

**Files:** `src/renderer/src/components/ShelfView.tsx`, new `DetailView.tsx`

**Problem:** Only a compact card list. Dropover has an expandable detail view with grid/list toggle.

**Fix:** Add an expand button to each shelf that opens a detail panel:

- Grid view: file thumbnails in a grid (like Finder's icon view)
- List view: rows with metadata (size, type, date)
- Detail view is a separate BrowserWindow or an expanded in-shelf panel

**Acceptance:** Clicking expand shows detail view; grid/list toggle works; Quick Look browsable in detail view.

---

### 2.5 Dock shelves (snap to screen edge)

**Files:** `src/main/windows/shelfWindow.ts`, new `dockManager.ts`

**Problem:** Shelves are always floating. Dropover docks shelves to screen edges.

**Fix:** Detect when a shelf is dragged near a screen edge and snap it:

```typescript
function snapToEdge(window: BrowserWindow): void {
  const bounds = window.getBounds()
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const area = display.workArea
  const threshold = 30

  if (bounds.x - area.x < threshold) {
    window.setBounds({ x: area.x, width: bounds.width }, true)
  }
  if (area.x + area.width - (bounds.x + bounds.width) < threshold) {
    window.setBounds({ x: area.x + area.width - bounds.width, width: bounds.width }, true)
  }
}
```

**Acceptance:** Dragging a shelf near the left/right screen edge snaps it into place.

---

## Phase 3 — Drop Zone Enhancements

### 3.1 Clipboard shelf

**Files:** `src/main/index.ts`, IPC handlers

**Problem:** No way to create a shelf from clipboard content.

**Fix:** Add IPC handler and global shortcut:

```typescript
ipcMain.handle('ledge:create-clipboard-shelf', async () => {
  const text = clipboard.readText()
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    const base64 = image.toPNG().toString('base64')
    await handleExternalPayload({ kind: 'image', mimeType: 'image/png', base64, filenameHint: 'clipboard-image' }, 'clipboard')
  } else if (text) {
    await handleExternalPayload(detectPayloadFromText(text), 'clipboard')
  }
  return broadcastState()
})
```

**Acceptance:** Cmd+Shift+V (or configured shortcut) creates a shelf with clipboard contents.

---

### 3.2 Notch drop detection

**Files:** `src/main/index.ts`, `src/main/windows/shelfWindow.ts`

**Problem:** Real Dropover lets you drop on the notch to create a shelf.

**Fix:** Detect when cursor is at the notch position (top-center of primary display, roughly the menu bar area):

```typescript
function isNearNotch(point: { x: number; y: number }): boolean {
  const primary = screen.getPrimaryDisplay()
  const notchWidth = 200 // approximate
  const notchHeight = primary.bounds.height - primary.workArea.height // menu bar height
  const centerX = primary.bounds.width / 2
  return (
    point.y < notchHeight + 10 &&
    point.x > centerX - notchWidth / 2 &&
    point.x < centerX + notchWidth / 2
  )
}
```

Listen for `drag-enter` events on a transparent overlay window positioned at the notch area.

**Acceptance:** Dropping a file on the notch area creates a new shelf.

---

### 3.3 Keep shelf open on drag-out

**Files:** `src/main/windows/shelfWindow.ts`, `src/renderer/src/components/ShelfView.tsx`

**Problem:** Dropover 5.2.1 added Shift+drag to keep the shelf open after dragging items out.

**Fix:** Listen for Shift key during drag-out:

```typescript
// In shelfWindow.ts
this.window.webContents.on('drag-end', () => {
  const shiftHeld = /* check via IPC or global key state */
  if (!shiftHeld) {
    this.hide()
  }
})
```

Show a "Keep Open" indicator while Shift is held during drag.

**Acceptance:** Holding Shift while dragging items out keeps the shelf visible.

---

## Phase 4 — Instant Actions & File Processing

### 4.1 Instant Actions system

**Files:** New `src/main/actions/` directory, `InstantActions.tsx`

**Problem:** No action execution system. Dropover's core differentiator.

**Fix:** Define an action registry:

```typescript
// src/main/actions/registry.ts
interface ShelfAction {
  id: string
  name: string
  icon: string
  description: string
  execute(items: ShelfItemRecord[], context: ActionContext): Promise<void>
}

const builtinActions: ShelfAction[] = [
  { id: 'zip', name: 'Create Archive', icon: '📦', ... },
  { id: 'resize-image', name: 'Resize Image', icon: '🖼️', ... },
  { id: 'extract-text', name: 'Extract Text', icon: '📝', ... },
  { id: 'upload-cloud', name: 'Upload to Cloud', icon: '☁️', ... },
  { id: 'copy-path', name: 'Copy Path', icon: '📋', ... },
]
```

In the renderer, show a lightning-bolt indicator below the shelf. Dragging items onto it previews the action, releasing executes it.

**Acceptance:** Lightning-bolt appears below shelf; dragging files on it shows action preview; releasing executes.

---

### 4.2 ZIP archive creation

**Files:** `src/main/actions/zip.ts`

**Fix:** Use Node.js `zlib` or call `ditto`:

```typescript
import { execFile } from 'node:child_process'

async function createZip(paths: string[], outputPath: string): Promise<void> {
  await execFile('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', ...paths, outputPath])
}
```

**Acceptance:** Selecting "Create Archive" on file items produces a .zip in the exports directory.

---

### 4.3 Image resize action

**Files:** `src/main/actions/resize.ts`

**Fix:** Use `sips` (built-in macOS tool):

```typescript
async function resizeImage(inputPath: string, width: number): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, `_${width}w$&`)
  await execFile('sips', ['-Z', String(width), inputPath, '--out', outputPath])
  return outputPath
}
```

Provide presets: 50%, 75%, 1024px, 2048px.

**Acceptance:** Resized image appears as a new shelf item.

---

### 4.4 Custom scripts support

**Files:** New `src/main/actions/customScripts.ts`, preferences schema

**Problem:** Users can't add their own actions.

**Fix:** Let users define shell commands in preferences:

```typescript
// schema.ts addition
customScripts: z.array(z.object({
  name: z.string(),
  command: z.string(),  // e.g., "open -a Preview {{files}}"
  icon: z.string().default('⚙️'),
})).default([])
```

Execute with `execFile`, substituting `{{files}}` with space-joined paths.

**Acceptance:** User-defined scripts appear in the action menu and execute correctly.

---

### 4.5 Command Bar (⌘K)

**Files:** New `CommandBar.tsx`, `CommandBar.module.css`

**Problem:** No quick-action launcher. Dropover has ⌘K Command Bar.

**Fix:** Build a spotlight-style search overlay:

- Triggered by Cmd+K (global shortcut or shelf-local)
- Shows a search input + list of matching actions
- Filters actions by name as user types
- Enter executes the selected action

**Acceptance:** Cmd+K opens overlay; typing filters actions; Enter executes.

---

## Phase 5 — Cloud Integration

### 5.1 Dropover Cloud (self-hosted)

**Files:** New `src/main/cloud/` directory

**Problem:** No cloud upload capability.

**Fix:** Build a minimal upload API:

- Backend: simple Express server or use a service like UploadThing
- Upload file → get shareable URL → copy to clipboard
- Store upload metadata (URL, expiry, filename) in state

**Acceptance:** "Upload" action uploads file and copies shareable link to clipboard.

---

### 5.2 AWS S3 integration

**Files:** `src/main/cloud/s3.ts`, preferences UI

**Fix:** Use `@aws-sdk/client-s3`:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

async function uploadToS3(filePath: string, config: S3Config): Promise<string> {
  const client = new S3Client({ region: config.region, credentials: config.credentials })
  const body = await fs.readFile(filePath)
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: `${Date.now()}-${basename(filePath)}`,
    Body: body,
    ContentType: guessMimeType(extname(filePath)),
  }))
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`
}
```

Preferences: access key, secret key, bucket, region, custom endpoint (for S3-compatible providers).

**Acceptance:** Configured S3 uploads produce shareable URLs.

---

### 5.3 Google Drive / OneDrive integration

**Files:** `src/main/cloud/gdrive.ts`, `src/main/cloud/onedrive.ts`

**Fix:** Use OAuth2 + respective REST APIs:

- Google: `googleapis.com/drive/v3/files`
- OneDrive: `graph.microsoft.com/v1.0/me/drive`

Store OAuth tokens in keychain (via `keytar` or `safeStorage`).

**Acceptance:** Auth flow completes; files upload; shareable links generated.

---

## Phase 6 — System Integration

### 6.1 Folder monitoring (Watched Folders)

**Files:** New `src/main/watchers/folderWatcher.ts`

**Problem:** No automatic shelf creation from folder changes.

**Fix:** Use `chokidar` or Node.js `fs.watch`:

```typescript
import { watch } from 'node:fs'

function watchFolder(folderPath: string, onChange: (paths: string[]) => void): () => void {
  const watcher = watch(folderPath, { recursive: true }, (event, filename) => {
    onChange([join(folderPath, filename)])
  })
  return () => watcher.close()
}
```

Preferences: list of watched folders + rules (include/exclude patterns).

**Acceptance:** Dropping a file into a watched folder opens a shelf with that file.

---

### 6.2 Screenshot shelf

**Files:** `src/main/watchers/screenshotWatcher.ts`

**Problem:** No auto-capture of screenshots.

**Fix:** Watch `~/Desktop` (default screenshot location) for new `.png` files:

```typescript
function startScreenshotWatcher(onScreenshot: (path: string) => void): () => void {
  const desktop = app.getPath('desktop')
  const watcher = watch(desktop, (_, filename) => {
    if (filename?.match(/Screenshot.*\.png$/)) {
      onScreenshot(join(desktop, filename))
    }
  })
  return () => watcher.close()
}
```

**Acceptance:** Taking a screenshot auto-opens a shelf with the screenshot file.

---

### 6.3 Share extension (macOS)

**Files:** New `native/ShareExtension/` directory

**Problem:** Can't receive files from other apps via the system Share menu.

**Fix:** Build a macOS Share Extension (requires Xcode project, not possible with Electron alone). Alternative: use `NSSharingServicePicker` via the native helper.

**Acceptance:** "Share to Ledge" appears in the system Share menu.

---

### 6.4 Siri Shortcuts

**Files:** New `native/IntentsExtension/`

**Problem:** No Siri integration.

**Fix:** Build an Intents Extension that exposes:
- "Add files to Ledge"
- "Open last shelf"
- "Create clipboard shelf"

This requires Xcode and Swift beyond what the Electron bridge can do.

**Acceptance:** Shortcuts app can invoke Ledge actions.

---

## Phase 7 — UI Polish & Accessibility

### 7.1 Dark mode support

**Files:** `src/renderer/src/styles.css`, all components

**Problem:** Light-only theme.

**Fix:** Use CSS custom properties with `prefers-color-scheme`:

```css
:root {
  --bg: rgba(247, 244, 238, 0.96);
  --surface: rgba(255, 255, 255, 0.82);
  --ink: #191715;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: rgba(30, 28, 26, 0.96);
    --surface: rgba(50, 48, 46, 0.82);
    --ink: #f0ece6;
    /* ... */
  }
}
```

Also detect Electron's `nativeTheme` and allow preference override.

**Acceptance:** App respects system dark mode; all UI elements render correctly in both modes.

---

### 7.2 Menu bar icon options

**Files:** `src/main/tray.ts`

**Problem:** One hardcoded SVG icon.

**Fix:** Offer 3-4 icon variants in preferences:

```typescript
const trayIcons = {
  default: createTrayImage('default'),
  outlined: createTrayImage('outlined'),
  filled: createTrayImage('filled'),
  shelf: createTrayImage('shelf'),
}
```

**Acceptance:** Switching icon in preferences updates the tray icon immediately.

---

### 7.3 Animations & transitions

**Files:** `src/renderer/src/styles.css`, `src/main/windows/shelfWindow.ts`

**Problem:** No entrance/exit animations.

**Fix:**
- Shelf appears: fade-in + scale(0.95→1) over 200ms
- Item added: slide-in from left over 150ms
- Item removed: fade-out + height collapse over 150ms
- Use `BrowserWindow` `animate` parameter for OS-level window animations

**Acceptance:** All shelf transitions are smooth; no jarring pops.

---

### 7.4 Keyboard navigation & accessibility

**Files:** All renderer components

**Problem:** No keyboard focus management, no ARIA labels.

**Fix:**
- All buttons: `aria-label`, `role="button"`
- Item list: `role="listbox"`, arrow key navigation
- Focus trap inside shelf window
- Screen reader announcements for state changes

**Acceptance:** Full keyboard navigation works; VoiceOver announces all elements.

---

### 7.5 Localization

**Files:** New `src/renderer/src/i18n/` directory

**Problem:** English-only.

**Fix:** Use `react-intl` or a simple JSON-based system:

```typescript
const strings = {
  en: { 'shelf.empty': 'Drop anything here', ... },
  de: { 'shelf.empty': 'Alles hier ablegen', ... },
  zh: { 'shelf.empty': '将文件拖放到此处', ... },
  nl: { 'shelf.empty': 'Sleep bestanden hierheen', ... },
}
```

Detect system language; allow override in preferences.

**Acceptance:** App displays in user's system language (at minimum: EN, DE, ZH, NL).

---

## Phase 8 — Testing & Distribution

### 8.1 Unit test coverage

**Files:** `*.test.ts` alongside source files

**Fix:** Achieve 80%+ coverage on:
- `stateStore.ts` — all CRUD operations, persistence, migration
- `payloads.ts` — all ingest types, MIME detection, text-to-URL detection
- `nativeAgent.ts` — IPC message handling, restart logic
- All React components — render, interaction, state updates

**Acceptance:** `pnpm test` passes with 80%+ coverage.

---

### 8.2 Integration tests

**Files:** New `test/integration/`

**Fix:** Test full flows:
- Create shelf → add items → close shelf → verify saved in recents
- Shake → shelf appears → drag file in → drag file out
- Preferences → toggle shake → verify native agent reconfigured

**Acceptance:** All integration tests pass.

---

### 8.3 Packaging & distribution

**File:** `package.json` build config

**Problem:** Build fails (observed during investigation).

**Fix:** Ensure `electron-builder` config is complete:
- Proper icon (`.icns`)
- Code signing entitlements
- Hardened runtime
- `entitlements.plist` with accessibility permissions

**Acceptance:** `pnpm dist` produces a working `.dmg` and `.zip` in `dist/`.

---

## Summary: Execution Order

```
Phase 1  Bug Fixes           ← Do immediately (8 tasks)
Phase 2  Multiple Shelves    ← Core architecture rewrite (5 tasks)
Phase 3  Drop Zone           ← Usability improvements (3 tasks)
Phase 4  Actions & Processing ← Core differentiator (5 tasks)
Phase 5  Cloud Integration   ← Major feature (3 tasks)
Phase 6  System Integration  ← Native feel (4 tasks)
Phase 7  UI Polish           ← Quality bar (5 tasks)
Phase 8  Testing & Shipping  ← Release readiness (3 tasks)
```

**Total: 36 tasks across 8 phases.**
Phase 1 is mandatory before anything else. Phases 2-4 are the core Dropover feature parity path. Phases 5-8 are polish and distribution.
