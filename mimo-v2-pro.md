Here is the full analysis of the current project vs. the real Dropover macOS app:

---

## PROJECT STATUS: Ledge (Dropover Clone)

**Architecture**: Electron 41 + React 19 + TypeScript + Zod + Swift native helper

**Build status**: TypeScript lint passes clean. Tests exist for payloads and state store.

---

## A. CODE BUGS & TECHNICAL ISSUES

### 1. Multi-monitor coordinate translation is broken
`native/DropShelfNativeAgent/Sources/DropShelfNativeAgent/main.swift:169-176`
```swift
private func electronPoint(for point: CGPoint) -> CGPoint {
    for screen in NSScreen.screens where screen.frame.contains(point) {
        let translatedY = screen.frame.maxY - point.y
        return CGPoint(x: point.x, y: translatedY)
    }
    return point
}
```
This only works correctly on the primary display. On secondary monitors, the Y-flip formula `frame.maxY - point.y` produces wrong coordinates because it doesn't account for the screen's origin offset relative to the global coordinate space.

### 2. Native agent crash = no recovery
`src/main/native/nativeAgent.ts:84-90` — When the Swift helper process exits, the code just sets status flags. There is no restart/reconnect logic. The user loses shake detection permanently until they restart the app.

### 3. Silent JSON parse failure in stdout reader
`src/main/native/nativeAgent.ts:188` — `JSON.parse(line)` is called without try/catch inside `consumeStdout`. If the native helper sends malformed JSON, the entire Electron main process will crash with an unhandled exception.

### 4. Blocking synchronous file I/O in main process
`src/main/services/stateStore.ts:207,215` — `readFileSync` and `writeFileSync` are used for state persistence. Every state mutation (add item, reorder, rename, etc.) triggers a synchronous disk write on the Electron main thread, which can cause UI jank.

### 5. No error handling on `payloadsFromTransfer` image iteration
`src/renderer/src/components/ShelfView.tsx:267-280` — The image data transfer processing iterates `transfer.items` and calls `item.getAsFile()` with no error handling. If a DataTransferItem is in an unusual state, this will throw and prevent the rest of the drop handler from completing.

### 6. MIME type detection is naive
`src/main/services/payloads.ts:172` — `mimeType` is set to `application/${extension}` which produces nonsensical types like `application/TXT` or `application/PDF` (uppercase). The `application/` prefix is also wrong for many formats.

### 7. No app exclusion persistence validation
The `excludedBundleIds` array in preferences has no validation for actual macOS bundle ID format. Users can type arbitrary strings in the textarea at `PreferencesView.tsx:83-97`.

### 8. IPC channel namespace mismatch
`src/shared/ipc.ts:12` — The channel prefix is `dropover:*` but the project is named "Ledge". This creates confusion and could cause conflicts if another Dropover-like app is running.

---

## B. MISSING FEATURES vs. Real Dropover

### Core Workflow Features (Critical)

| Feature | Real Dropover | Ledge Status |
|---------|--------------|--------------|
| **Multiple simultaneous shelves** | Unlimited shelves | Only 1 live shelf at a time |
| **Pinned shelves** | Pin up to 6 to menu bar | Not implemented |
| **Shelf Detail View** | Expandable detail view with grid/list | Not implemented |
| **Dock shelves** | Shelves snap to screen edges | Not implemented |
| **Clipboard shelf** | Create shelf from clipboard content | Not implemented |
| **Notch drop** | Drop on notch to create shelf | Not implemented |
| **Keep-open on drag out** | Shift to keep shelf open | Not implemented |

### Actions & Processing (Critical)

| Feature | Real Dropover | Ledge Status |
|---------|--------------|--------------|
| **Instant Actions** | Configurable lightning-bolt actions below shelf | Not implemented |
| **Built-in file actions** | Resize images, extract text, create ZIP, HEIC conversion | Not implemented |
| **Custom actions/scripts** | AppleScript, shell scripts, Automator | Not implemented |
| **Command Bar** | ⌘K quick-action search | Not implemented |
| **File renaming** | Rename files on shelf | Not implemented |

### Cloud & Sharing (Major)

| Feature | Real Dropover | Ledge Status |
|---------|--------------|--------------|
| **Dropover Cloud** | Built-in anonymous file hosting | Not implemented |
| **AWS S3 integration** | Upload to S3-compatible providers | Not implemented |
| **Google Drive** | Upload to Google Drive | Not implemented |
| **OneDrive** | Upload to OneDrive | Not implemented |
| **iCloud Drive** | Upload to iCloud | Not implemented |
| **Imgur** | Image hosting | Not implemented |
| **Share extensions** | Receive files from system Share menu | Not implemented |
| **Services menu** | Add files from any app's Services menu | Not implemented |

### System Integration (Major)

| Feature | Real Dropover | Ledge Status |
|---------|--------------|--------------|
| **Control Center widgets** | macOS 26 widgets for shelf actions | Not implemented |
| **Desktop widgets** | Recent shelves on desktop | Not implemented |
| **Folder monitoring** | Auto-open shelf when folder changes | Not implemented |
| **Screenshot shelf** | Auto-capture screenshots to shelf | Not implemented |
| **Siri Shortcuts** | Add/upload/access via Siri | Not implemented |
| **Alfred/Raycast extensions** | Workflow integrations | Not implemented |
| **Keyboard shortcuts editor** | Full customizable shortcut configuration | Partial (only global shortcut string) |

### UI Polish (Moderate)

| Feature | Real Dropover | Ledge Status |
|---------|--------------|--------------|
| **Color-coded shelves** | Custom colors per shelf | Only 4 hardcoded colors (ember/wave/forest/sand) |
| **Dark mode** | Full dark/light mode support | Light only |
| **Localization** | English, German, Chinese, Dutch | English only |
| **Animations** | Smooth transitions on appear/drop/drag-out | Minimal CSS transitions |
| **Menu bar icon options** | Multiple icon variants | 1 hardcoded SVG |
| **Shelf position preferences** | Near cursor, bottom screen, etc. | Always near cursor |
| **Context menus** | Right-click actions on items | Not implemented |

---

## C. ARCHITECTURAL RISKS

1. **Electron vs Native**: Real Dropover is a 36.7MB native Swift app. This Electron build will be 150-300MB with worse performance, higher memory usage, and less macOS integration (no native share sheets, no proper system notifications, limited AppleScript support).

2. **Single-shelf state architecture**: The entire `StateStore` is designed around one `liveShelf`. Supporting multiple simultaneous shelves requires a fundamental rewrite of the state management, window management, and IPC contract.

3. **No menu bar app behavior enforcement**: Dropover enforces "can only quit via menu bar" behavior. The current `app.dock.hide()` approach is rudimentary and doesn't handle the "stay alive" semantics properly.

4. **No data migration path**: The `state.json` schema has no version field or migration system. Any schema change will silently reset all user data.

5. **Security**: The CSP in `index.html:7` allows `unsafe-eval` and localhost connections. The sandbox is disabled (`sandbox: false`). These are security risks for a production desktop app.

---

## D. PRIORITY ROADMAP SUGGESTION

**Phase 1 — Fix bugs & stabilize foundation** (items A1-A8)

**Phase 2 — Multiple shelves + pinned shelves** (requires state architecture rewrite)

**Phase 3 — Instant Actions + file actions** (core differentiator feature)

**Phase 4 — Cloud integrations** (Dropover Cloud first, then S3/GDrive/OneDrive)

**Phase 5 — System integration** (Control Center, widgets, folder monitoring, screenshots)

**Phase 6 — Polish** (dark mode, localization, animations, context menus)


GitHub Issue Comment for Dropshelf

Here's the complete issue comment formatted for GitHub:

---

# Implementation Plan for Dropshelf UI

Here is a complete, step-by-step plan to build a React-based Electron UI for "Dropshelf" — a macOS menu-bar drag-and-drop shelf utility. Each phase includes concrete tasks with acceptance criteria.

## Phase 0 — Scaffold & Prerequisites

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 0.1 | Add a `renderer` entry to `forge.config.js` Webpack configs pointing at `src/renderer/index.tsx` | `npm run package` still succeeds; new renderer chunk emitted |
| 0.2 | Create `src/renderer/index.tsx` with `ReactDOM.render(<App/>, document.getElementById('root'))` | Dev window loads without errors |
| 0.3 | Create shell component `ShelfPanel.tsx` and `ShelfPanel.module.css` with a 320×420 frosted-glass panel | Visual: translucent rounded rect with `backdrop-filter: blur(18px) saturate(180%)` |
| 0.4 | Define shared types in `src/types/shelf.ts` (`ShelfItem`, `IngestPayload`, `ShelfAction`, `DropoverState`) | TypeScript compiles; types used by at least one component |
| 0.5 | Verify the existing `SHAKE_DETECTED`, `ADD_ITEMS`, `SHELF_ACTION` IPC channels are wired end-to-end (preload → main) | Sending a fake `ADD_ITEMS` from DevTools shows items in the shelf panel |

## Phase 1 — Shelf Panel (core container)

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 1.1 | Implement `ShelfPanel` component: accept `items: ShelfItem[]`, `onAction`, `onClose` props | Renders an empty shelf with header, footer, and "Drop files here" placeholder |
| 1.2 | Add header bar with editable shelf name (`<input>`) and a "Close" button | Clicking Close calls `window.electron.closeShelf()` |
| 1.3 | Add empty-state placeholder text + subtle icon (use a unicode glyph like 📥) | Placeholder visible when `items.length === 0` |
| 1.4 | Wire IPC: subscribe to `ShelfState` updates via `ipcRenderer.on('shelf-state')`, feed into React state | Dropping a file via `ADD_ITEMS` from main shows the item |
| 1.5 | Add CSS: `background: rgba(255,255,255,0.55)`, `backdrop-filter: blur(18px) saturate(180%)`, 12px border-radius, 1px solid `rgba(0,0,0,0.12)`, drop-shadow | Panel matches frosted-glass design spec |

## Phase 2 — Item Rows

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 2.1 | Create `ItemRow.tsx` + `ItemRow.module.css` | Renders a single shelf item |
| 2.2 | Thumbnail: use `<img>` for image mime-types; fall back to an SVG file-type icon (PDF, generic doc, folder) | Images show inline preview; non-images show correct icon |
| 2.3 | File info: display filename (bold, 13px SF Pro), file size, and mime-type badge | Text truncates with ellipsis at 240px width |
| 2.4 | Action buttons: "Quick Look", "Reveal in Finder", "Copy", "Delete" — each calls `onAction(item, action)` | Buttons visible on hover (opacity transition 0→1) |
| 2.5 | Inline rename: double-click filename → `<input>` with blur/Enter to commit | Renamed file persists in state |
| 2.6 | Wire "Quick Look" button to `window.electron.quickLook(path)` via IPC | macOS Quick Look panel appears |
| 2.7 | Wire "Reveal in Finder" to `shell.showItemInFolder(path)` via IPC | Finder opens with file selected |
| 2.8 | Wire "Copy" to `clipboard.writeBuffer()` for files / `clipboard.writeText()` for text | Pasting elsewhere yields the copied content |

## Phase 3 — Drop Zone

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 3.1 | Create `DropZone.tsx`: invisible overlay `div` covering the entire `ShelfPanel` | No visual change; intercepts drag events |
| 3.2 | On `dragover`: prevent default, show a dashed-border highlight + "Release to add" text | Highlight appears when dragging a file over the panel |
| 3.3 | On `drop`: extract `file.path` from each file, call `window.electron.addFiles(paths)` via IPC | Dropped file appears as a new `ItemRow` |
| 3.4 | On `dragleave`: remove highlight | Highlight disappears when cursor leaves panel |
| 3.5 | Visual feedback: animate highlight in/out with 150ms opacity transition | Smooth appearance/disappearance |

## Phase 4 — Empty State / Onboarding Hints

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 4.1 | When `items.length === 0`, show centered text: "Drag files here to collect them" | Visible in empty shelf |
| 4.2 | Below the text, show 3 hint chips: "Shake cursor", "⌘⇧S", "Menu bar" | Each chip is a styled `<span>` with a subtle background |
| 4.3 | Clicking the "Menu bar" chip calls `window.electron.openMenuBar()` (tray click) | Menu bar popup opens |
| 4.4 | When items are added, hints fade out with 200ms transition | Hints disappear smoothly when first item arrives |

## Phase 5 — Menu Bar Popup (Preferences + Quick Actions)

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 5.1 | Create `MenuBarPopup.tsx` + `MenuBarPopup.module.css` | Renders as a compact dropdown-style panel |
| 5.2 | Section: "Recent Shelves" — list of last 3 closed shelves (name + item count) | Clicking a shelf calls `window.electron.restoreShelf(id)` |
| 5.3 | Section: "Preferences" — toggle "Launch at login", "Hide dock icon", "Shake sensitivity" slider | Toggles call `window.electron.setPreference(key, value)` |
| 5.4 | Section: "Storage" — show cache size in MB + "Clear" button | Clear button calls `window.electron.clearCache()` |
| 5.5 | Section: "Keyboard Shortcut" — display current shortcut + "Change" button | Change opens a capture-mode `<input>` that listens for keydown |
| 5.6 | Wire IPC: `MENU_BAR_CLICK` opens the popup window | Clicking tray icon shows the popup |

## Phase 6 — Action Confirmation UI

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 6.1 | Create `ActionConfirm.tsx`: a 160×80 translucent card with action name + "Confirm" / "Cancel" buttons | Card appears centered over the shelf panel |
| 6.2 | Show for destructive actions: "Delete", "Clear All", "Clear Cache" | `onAction` intercepts these and shows `ActionConfirm` |
| 6.3 | Confirm → execute action; Cancel → dismiss card | Both paths work correctly |
| 6.4 | Animate in with scale(0.9)→scale(1) + opacity 0→1, 150ms ease-out | Smooth appearance animation |
| 6.5 | Escape key dismisses the confirmation | Pressing Escape acts as Cancel |

## Phase 7 — Visual Polish

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 7.1 | Font: `-apple-system, "SF Pro Text", BlinkMacSystemFont, "Segoe UI"` everywhere | All text uses system font stack |
| 7.2 | Transitions: 150ms ease-out for hover/focus on all interactive elements | Buttons, inputs, and rows all animate |
| 7.3 | Thumbnails: 32×32 `border-radius: 6px` for images; 24×24 SVG icons for files | Consistent sizing across all item types |
| 7.4 | Shadows: `0 8px 32px rgba(0,0,0,0.18)` on the shelf panel | Panel has depth |
| 7.5 | Title bar: `border-radius: 12px 12px 0 0`, 44px height, centered title | Top of panel is rounded |
| 7.6 | Footer: 32px height, left-aligned "Clear All" link, right-aligned item count | Footer matches spec |
| 7.7 | Keyboard focus: `:focus-visible` outline (2px accent color, 4px offset) | Tab navigation shows clear focus rings |
| 7.8 | macOS vibrancy: set `vibrancy: 'under-window'` on BrowserWindow in main process | Panel has native vibrancy effect |

## Phase 8 — Testing & QA

| Task | Description | Acceptance Criteria |
|------|-------------|-------------------|
| 8.1 | Unit test: `ShelfPanel` renders empty state and populated state | Jest + React Testing Library pass |
| 8.2 | Unit test: `ItemRow` renders thumbnail, filename, actions; double-click triggers rename | Tests pass |
| 8.3 | Unit test: `DropZone` fires `addFiles` on drop event | Tests pass |
| 8.4 | Integration test: IPC round-trip — add item via `ADD_ITEMS`, verify it appears in `ShelfPanel` | Test passes with mocked IPC |
| 8.5 | Manual test: drag 10 files onto shelf → all appear, scroll works | Verified on macOS |
| 8.6 | Manual test: shake cursor → shelf appears → drag file out → file copies to destination | Verified on macOS |
| 8.7 | Manual test: click tray icon → menu bar popup opens → preferences toggles work | Verified on macOS |
| 8.8 | Manual test: Quick Look, Reveal in Finder, Copy, Delete all work for file items | Verified on macOS |
| 8.9 | Manual test: text items show Copy and Save As buttons; both work | Verified on macOS |
| 8.10 | Manual test: rename file → new name persists after blur | Verified on macOS |

## Implementation Order

The phases should be implemented in this order, with each phase building on the previous:

```
Phase 0 (Scaffold)        ← Do first, unblocks everything
  ↓
Phase 1 (Shelf Panel)     ← Core container
  ↓
Phase 2 (Item Rows)       ← Content display
  ↓
Phase 3 (Drop Zone)       ← Input mechanism
  ↓
Phase 4 (Empty State)     ← UX polish
  ↓
Phase 5 (Menu Bar)        ← Preferences & management
  ↓
Phase 6 (Action Confirm)  ← Safety
  ↓
Phase 7 (Visual Polish)   ← Design refinement
  ↓
Phase 8 (Testing)         ← Quality assurance
```

## Key Architecture Decisions

1. **CSS Modules** — Use `*.module.css` files co-located with components to avoid global style collisions
2. **IPC via Preload** — All renderer→main communication goes through `window.electron` exposed via `preload.js` (contextIsolation)
3. **Component Props** — Components receive data and callbacks via props; no direct IPC calls inside components (except through the `window.electron` bridge)
4. **State Management** — Use React `useState` + `useEffect` for local state; no Redux/Zustand needed for this scope
5. **Accessibility** — All interactive elements have `aria-label`, keyboard focus support, and semantic HTML

Each phase is designed to be independently shippable — you can stop after any phase and have a working (if incomplete) UI.
