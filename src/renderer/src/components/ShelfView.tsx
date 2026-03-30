import { useDeferredValue, useEffect, useState } from 'react'
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema'

interface ShelfViewProps {
  state: AppState
}

export function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelf
  const recentShelves = useDeferredValue(state.recentShelves)
  const [nameDraft, setNameDraft] = useState(liveShelf?.name ?? 'Untitled Shelf')
  const [isImporting, setIsImporting] = useState(false)
  const shareableCount =
    liveShelf?.items.filter(
      (item) => (item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset') && !item.file.isMissing
    ).length ?? 0
  const shortcutLabel = !state.preferences.globalShortcut
    ? 'Shortcut off'
    : state.permissionStatus.shortcutRegistered
      ? `Shortcut: ${state.preferences.globalShortcut}`
      : 'Shortcut unavailable'
  const helperLabel = !state.permissionStatus.nativeHelperAvailable
    ? 'Helper unavailable'
    : state.preferences.shakeEnabled
      ? state.permissionStatus.shakeReady
        ? `Shake: ${state.preferences.shakeSensitivity}`
        : 'Shake blocked'
      : 'Shake off'
  const banner =
    !state.permissionStatus.nativeHelperAvailable
      ? {
          title: 'Native helper is unavailable',
          copy: state.permissionStatus.lastError || 'Rebuild the bundled helper to re-enable shake detection.'
        }
      : state.preferences.shakeEnabled && !state.permissionStatus.accessibilityTrusted
        ? {
            title: 'Accessibility access is off',
            copy: 'Enable it if you want shake-to-open.'
          }
        : state.permissionStatus.lastError
          ? {
              title: 'Native helper reported an error',
              copy: state.permissionStatus.lastError
            }
          : null

  useEffect(() => {
    setNameDraft(liveShelf?.name ?? 'Untitled Shelf')
  }, [liveShelf?.id, liveShelf?.name])

  async function pushPayloads(payloads: IngestPayload[]) {
    if (payloads.length === 0) {
      return
    }

    setIsImporting(true)
    try {
      if (!liveShelf) {
        await window.dropover.createShelf({ reason: 'manual' })
      }

      for (const payload of payloads) {
        await window.dropover.addPayload(payload)
      }
    } finally {
      setIsImporting(false)
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    await pushPayloads(await payloadsFromTransfer(event.dataTransfer))
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const payloads = await payloadsFromTransfer(event.clipboardData)
    if (payloads.length === 0) {
      return
    }

    event.preventDefault()
    await pushPayloads(payloads)
  }

  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!liveShelf) {
      return
    }

    const items = [...liveShelf.items]
    const index = items.findIndex((item) => item.id === itemId)
    const targetIndex = index + direction
    if (index === -1 || targetIndex < 0 || targetIndex >= items.length) {
      return
    }

    const next = [...items]
    const [entry] = next.splice(index, 1)
    next.splice(targetIndex, 0, entry)
    await window.dropover.reorderItems(next.map((item) => item.id))
  }

  const itemCount = liveShelf?.items.length ?? 0

  return (
    <main className="shelf-shell" onPaste={handlePaste} tabIndex={0}>
      <section className="shelf-panel" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <header className="shelf-topbar">
          <div className="shelf-title-group">
            <div className="shelf-handle" />
            <input
              className="shelf-name compact"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void window.dropover.renameShelf(nameDraft)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
          </div>

          <div className="toolbar-actions">
            <button className="toolbar-button" onClick={() => void window.dropover.shareShelfItems()} disabled={shareableCount === 0}>
              Share
            </button>
            <button className="toolbar-button" onClick={() => void window.dropover.clearShelf()} disabled={itemCount === 0}>
              Clear
            </button>
            <button className="toolbar-button destructive" onClick={() => void window.dropover.closeShelf()}>
              Close
            </button>
          </div>
        </header>

        <section className={`drop-surface compact ${itemCount === 0 ? 'is-empty' : ''}`}>
          <div className="surface-headline">
            <div>
              <p className="surface-title compact">{itemCount === 0 ? 'Drop anything here' : `${itemCount} item${itemCount === 1 ? '' : 's'} on shelf`}</p>
              <p className="surface-subtitle compact">
                Files, folders, text, links, and pasted images. Unavailable files stay on the shelf until you remove them.
              </p>
            </div>
            <div className="status-pill compact">{isImporting ? 'Importing' : liveShelf?.origin ?? 'standby'}</div>
          </div>

          {itemCount === 0 ? (
            <div className="empty-state compact">
              <p>Shake, use the tray, or trigger your shortcut to open a shelf near the cursor.</p>
              <div className="meta-strip">
                <span className="meta-chip">{shortcutLabel}</span>
                <span className="meta-chip">{helperLabel}</span>
              </div>
            </div>
          ) : (
            <div className="item-list compact">
              {liveShelf?.items.map((item, index) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isFirst={index === 0}
                  isLast={index === liveShelf.items.length - 1}
                  onMove={moveItem}
                />
              ))}
            </div>
          )}
        </section>

        {banner ? (
          <section className="permission-banner compact">
            <div>
              <p className="banner-title">{banner.title}</p>
              <p className="banner-copy">{banner.copy}</p>
            </div>
            <button className="ghost-button small" onClick={() => void window.dropover.openPermissionSettings()}>
              Open Settings
            </button>
          </section>
        ) : null}

        <footer className="shelf-footer">
          <div className="recent-inline">
            {recentShelves.length === 0 ? (
              <span className="footer-note">No recent shelves yet.</span>
            ) : (
              recentShelves.slice(0, 3).map((shelf) => (
                <button key={shelf.id} className="recent-pill" onClick={() => void window.dropover.restoreShelf(shelf.id)}>
                  {shelf.name} <span>{shelf.items.length}</span>
                </button>
              ))
            )}
          </div>

          <div className="footer-meta">
            <span className="footer-note">Single live shelf</span>
            <span className="footer-note">{state.preferences.excludedBundleIds.length} excluded apps</span>
          </div>
        </footer>
      </section>
    </main>
  )
}

interface ItemCardProps {
  item: ShelfItemRecord
  isFirst: boolean
  isLast: boolean
  onMove(itemId: string, direction: -1 | 1): Promise<void>
}

function ItemCard({ item, isFirst, isLast, onMove }: ItemCardProps) {
  const fileBacked = item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset'
  const badge = fileBacked ? (item.kind === 'folder' ? 'Folder' : item.kind === 'imageAsset' ? 'Image' : 'File') : item.kind === 'url' ? 'Link' : 'Text'
  const missing = fileBacked && item.file.isMissing
  const stale = fileBacked && item.file.isStale && !missing
  const fileStatus = missing ? 'Missing from disk' : stale ? 'Resolved from bookmark' : ''
  const previewCopy = missing ? item.file.originalPath : item.preview.summary
  const actionTitle = missing ? 'This item is no longer available on disk.' : undefined

  return (
    <article
      className={`item-card compact item-${item.kind}${missing ? ' is-missing' : ''}`}
      draggable={fileBacked && !missing}
      onDragStart={(event) => {
        if (!fileBacked || missing) {
          return
        }

        event.preventDefault()
        window.dropover.startItemDrag(item.id)
      }}
    >
      <div className="item-card-main compact">
        <div className="item-copy">
          <div className="item-badge">{badge}</div>
          <div>
            <p className="item-title compact">{item.title}</p>
            <p className="item-subtitle compact">{fileStatus || item.subtitle || item.preview.summary}</p>
          </div>
        </div>
        <div className="item-controls">
          <button className="mini-button compact" onClick={() => void onMove(item.id, -1)} disabled={isFirst} aria-label="Move item up">
            ↑
          </button>
          <button className="mini-button compact" onClick={() => void onMove(item.id, 1)} disabled={isLast} aria-label="Move item down">
            ↓
          </button>
          <button className="mini-button compact destructive" onClick={() => void window.dropover.removeItem(item.id)} aria-label="Remove item">
            ×
          </button>
        </div>
      </div>

      <p className="item-preview compact">{previewCopy}</p>

      <div className="item-actions compact">
        {fileBacked ? (
          <>
            <button className="ghost-button small" onClick={() => void window.dropover.previewItem(item.id)} disabled={missing} title={actionTitle}>
              Quick Look
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.revealItem(item.id)} disabled={missing} title={actionTitle}>
              Reveal
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.openItem(item.id)} disabled={missing} title={actionTitle}>
              Open
            </button>
          </>
        ) : null}
        {item.kind === 'text' || item.kind === 'url' ? (
          <>
            <button className="ghost-button small" onClick={() => void window.dropover.copyItem(item.id)}>
              Copy
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.saveItem(item.id)}>
              Save
            </button>
            {item.kind === 'url' ? (
              <button className="ghost-button small" onClick={() => void window.dropover.openItem(item.id)}>
                Open
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  )
}

async function payloadsFromTransfer(transfer: DataTransfer): Promise<IngestPayload[]> {
  const payloads: IngestPayload[] = []
  const filePaths = Array.from(transfer.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path))

  if (filePaths.length > 0) {
    payloads.push({
      kind: 'fileDrop',
      paths: [...new Set(filePaths)]
    })
  }

  const imageItems = Array.from(transfer.items as DataTransferItemList).filter((item) => item.type.startsWith('image/'))
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) {
      continue
    }

    const maybePath = (file as File & { path?: string }).path
    if (maybePath) {
      continue
    }

    payloads.push(await imageToPayload(file))
  }

  if (payloads.length === 0) {
    const uriList = transfer.getData('text/uri-list').trim()
    if (uriList) {
      payloads.push({
        kind: 'url',
        url: uriList.split('\n')[0],
        label: uriList.split('\n')[0]
      })
    }
  }

  const text = transfer.getData('text/plain').trim()
  if (text && payloads.length === 0) {
    try {
      const parsed = new URL(text)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        payloads.push({
          kind: 'url',
          url: parsed.toString(),
          label: parsed.hostname
        })
      } else {
        payloads.push({
          kind: 'text',
          text
        })
      }
    } catch {
      payloads.push({
        kind: 'text',
        text
      })
    }
  }

  return payloads
}

async function imageToPayload(file: File): Promise<IngestPayload> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return {
    kind: 'image',
    mimeType: file.type || 'image/png',
    base64: btoa(binary),
    filenameHint: file.name || 'drop-image'
  }
}
