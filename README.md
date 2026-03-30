# Ledge

Ledge is a macOS-only Electron utility inspired by the core Dropover shelf workflow. It ships a menu-bar-first Electron shell, a React renderer, and a small Swift helper that detects shake gestures and manages bookmark-based file references.

## Status

This project currently targets Apple Silicon Macs running macOS 12 or newer. It is optimized for local development and direct-download distribution rather than the Mac App Store.

## Included in this repo

- One live shelf plus recent shelf restore
- Tray, shortcut, and shake-based shelf creation
- File, folder, text, URL, and pasted-image ingest
- Quick Look, reveal/open, copy, save, share, and drag-out actions
- JSON state persistence in `~/Library/Application Support/Ledge`
- A Swift helper compiled from `native/DropShelfNativeAgent`

## Development

```bash
corepack enable
pnpm install
pnpm dev
```

If Electron does not finish downloading during install, run:

```bash
node node_modules/.pnpm/electron@41.1.0/node_modules/electron/install.js
```

## Packaged app

Build a branded macOS app bundle and distributables with:

```bash
pnpm dist
```

Outputs are written to `dist/`, including `dist/mac-arm64/Ledge.app`.

macOS Accessibility permissions are tied to the actual app bundle. If you want System Settings to show `Ledge` with its icon instead of the generic Electron dev host, launch the packaged app.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```

## Repository layout

- `src/main`: Electron main process, tray, windows, persistence, and native bridge
- `src/preload`: secure preload bridge exposed to the renderer
- `src/renderer`: React UI for the shelf and preferences windows
- `src/shared`: shared schemas and IPC contracts
- `native/DropShelfNativeAgent`: Swift helper for shake detection and bookmark resolution
- `scripts`: local build helpers for branding and the native agent

## License

MIT
