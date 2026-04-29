import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema';
import { getExportableItems, getHeroCountLabel, getHeroMode, type HeroMode, type SessionMode } from './shelfFlow';
import {
  IconClose,
  IconMenuDots,
  IconChevronDown,
  IconChevronLeft,
  IconGear,
  IconGrid,
  IconList,
  IconFolder,
} from './Icons';

interface ShelfViewProps {
  state: AppState;
}

export function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelf;
  const items = liveShelf?.items ?? [];
  const primaryItem = items[0] ?? null;
  const itemCount = items.length;
  const heroMode = getHeroMode(items);
  const [isImporting, setIsImporting] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('idle');
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemSheetRef = useRef<HTMLDivElement | null>(null);
  const lastUpdatedAtRef = useRef(liveShelf?.updatedAt ?? '');
  const dragDepthRef = useRef(0);
  const isAcceptingDrop = sessionMode === 'acceptingDrop';
  const isExporting = sessionMode === 'exporting';
  const isMenuOpen = sessionMode === 'menuOpen';
  const isItemListOpen = sessionMode === 'itemListOpen';
  const banner = !state.permissionStatus.nativeHelperAvailable
    ? {
        title: 'Native helper is unavailable',
        copy: state.permissionStatus.lastError || 'Rebuild the bundled helper to re-enable shake detection.',
      }
    : state.preferences.shakeEnabled && !state.permissionStatus.accessibilityTrusted
      ? {
          title: 'Accessibility access is off',
          copy: 'Enable it if you want shake-to-open.',
        }
      : state.permissionStatus.lastError
        ? {
            title: 'Native helper reported an error',
            copy: state.permissionStatus.lastError,
          }
        : null;

  useEffect(() => {
    dragDepthRef.current = 0;
    setSessionMode('idle');
  }, [liveShelf?.id]);

  useEffect(() => {
    const nextUpdatedAt = liveShelf?.updatedAt ?? '';
    const didMutateShelf = lastUpdatedAtRef.current !== '' && lastUpdatedAtRef.current !== nextUpdatedAt;

    if (didMutateShelf && sessionMode === 'exporting') {
      setSessionMode('idle');
    }

    lastUpdatedAtRef.current = nextUpdatedAt;
  }, [liveShelf?.updatedAt, sessionMode]);

  useEffect(() => {
    if (liveShelf || itemCount !== 0) {
      return;
    }

    dragDepthRef.current = 0;
    setSessionMode('idle');
  }, [itemCount, liveShelf]);

  useEffect(() => {
    const handleFocus = () => {
      setSessionMode((current) => (current === 'exporting' ? 'idle' : current));
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (sessionMode !== 'menuOpen' && sessionMode !== 'itemListOpen') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (sessionMode === 'menuOpen') {
        if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) {
          return;
        }
      }

      if (sessionMode === 'itemListOpen' && itemSheetRef.current?.contains(target)) {
        return;
      }

      setSessionMode('idle');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setSessionMode('idle');
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionMode]);

  async function pushPayloads(payloads: IngestPayload[]) {
    if (payloads.length === 0) {
      return;
    }

    setIsImporting(true);
    setSessionMode('idle');

    try {
      if (!liveShelf) {
        await window.ledge.createShelf({ reason: 'manual' });
      }

      await window.ledge.addPayloads(payloads);
    } finally {
      setIsImporting(false);
    }
  }

  function resetDropState() {
    dragDepthRef.current = 0;
    setSessionMode((current) => (current === 'acceptingDrop' ? 'idle' : current));
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    dragDepthRef.current += 1;
    setSessionMode('acceptingDrop');
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    const nextDepth = Math.max(0, dragDepthRef.current - 1);
    dragDepthRef.current = nextDepth;

    if (nextDepth === 0 && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setSessionMode((current) => (current === 'acceptingDrop' ? 'idle' : current));
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (sessionMode !== 'acceptingDrop') {
      setSessionMode('acceptingDrop');
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    resetDropState();
    await pushPayloads(await payloadsFromTransfer(event.dataTransfer));
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const payloads = await payloadsFromTransfer(event.clipboardData);
    if (payloads.length === 0) {
      return;
    }

    event.preventDefault();
    await pushPayloads(payloads);
  }

  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!liveShelf) {
      return;
    }

    const currentItems = [...liveShelf.items];
    const index = currentItems.findIndex((item) => item.id === itemId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= currentItems.length) {
      return;
    }

    const next = [...currentItems];
    const [entry] = next.splice(index, 1);
    next.splice(targetIndex, 0, entry);
    await window.ledge.reorderItems(next.map((item) => item.id));
  }

  async function openOverflowMenu() {
    if (!liveShelf) {
      return;
    }
    await window.ledge.showShelfContextMenu();
  }

  function openItemSheet() {
    setSessionMode('itemListOpen');
  }

  function closeTransientSurface() {
    dragDepthRef.current = 0;
    setSessionMode('idle');
  }

  return (
    <main
      className={`shelf-shell${isAcceptingDrop ? ' is-accepting-drop' : ''}${isExporting ? ' is-exporting' : ''}${isItemListOpen ? ' has-item-sheet' : ''}`}
      onPaste={handlePaste}
      tabIndex={0}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPointerEnter={() => {
        if (isExporting) {
          setSessionMode('idle');
        }
      }}
    >
      <div className="drag-handle" />

      {isItemListOpen && liveShelf ? (
        <ItemSheet items={items} sheetRef={itemSheetRef} onClose={closeTransientSurface} />
      ) : (
        <>
          <header className="shelf-topbar">
            <button
              className="chrome-button chrome-button-close"
              onClick={() => void window.ledge.closeShelf()}
              aria-label="Close shelf"
            >
              <IconClose />
            </button>

            <button
              ref={menuButtonRef}
              className="chrome-button chrome-button-menu"
              onClick={openOverflowMenu}
              disabled={!liveShelf || isExporting}
              aria-label="Open shelf actions"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <IconMenuDots />
            </button>
          </header>

          <section
            className={`drop-surface compact ${itemCount === 0 ? 'is-empty' : ''}${isAcceptingDrop ? ' is-accepting' : ''}`}
          >
            {itemCount === 0 ? (
              <div className="empty-state compact">
                <p className="surface-title compact">Drop files here</p>
              </div>
            ) : primaryItem ? (
              <HeroItem
                items={items}
                item={primaryItem}
                heroMode={heroMode}
                isImporting={isImporting}
                isExporting={isExporting}
                dragLocked={isMenuOpen || isItemListOpen}
                onExportStart={() => {
                  setSessionMode('exporting');
                }}
                onExportEnd={() => {
                  setSessionMode((current) => (current === 'exporting' ? 'idle' : current));
                }}
                onOpenItemSheet={openItemSheet}
              />
            ) : (
              <div className="empty-state compact">
                <p className="surface-title compact">Drop files here</p>
              </div>
            )}
          </section>

          {banner ? (
            <section className="permission-banner compact">
              <div>
                <p className="banner-title">{banner.title}</p>
                <p className="banner-copy">{banner.copy}</p>
              </div>
              <button className="ghost-button small" onClick={() => void window.ledge.openPermissionSettings()}>
                Open Settings
              </button>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

interface ItemSheetProps {
  items: ShelfItemRecord[];
  sheetRef: RefObject<HTMLDivElement | null>;
  onClose(): void;
}

function ItemSheet({ items, sheetRef, onClose }: ItemSheetProps) {
  return (
    <section ref={sheetRef} className="item-sheet" aria-label="Shelf items">
      <header className="item-sheet-header">
        <button className="ghost-button icon-button" onClick={onClose} aria-label="Back">
          <IconChevronLeft />
        </button>
        <div className="item-sheet-header-center">
          <p className="item-sheet-title">{items.length} Files</p>
          <p className="item-sheet-copy">{items.length > 0 ? 'Items in shelf' : ''}</p>
        </div>
        <div className="item-sheet-actions">
          <button className="ghost-button icon-button" aria-label="Settings">
            <IconGear />
          </button>
          <button className="ghost-button icon-button active" aria-label="Grid View">
            <IconGrid />
          </button>
          <button className="ghost-button icon-button" aria-label="List View">
            <IconList />
          </button>
        </div>
      </header>
      <div className="item-sheet-grid">
        {items.map((item) => (
          <div
            className="item-grid-cell"
            key={item.id}
            onContextMenu={(e) => {
              e.preventDefault();
              window.ledge.showItemContextMenu(item.id);
            }}
          >
            <div className="item-grid-preview">
              {getHeroPreviewSource(item) ? (
                <img src={getHeroPreviewSource(item) || undefined} alt={item.title} />
              ) : (
                <HeroGlyph kind={item.kind} />
              )}
            </div>
            <p className="item-grid-title">{item.title}</p>
            <p className="item-grid-subtitle">{item.preview.summary || item.subtitle || 'File'}</p>
          </div>
        ))}
        {items.length > 0 && (
          <div className="item-grid-cell action-cell" onClick={() => window.ledge.revealItem(items[0]?.id)}>
            <div className="item-grid-preview action-preview">
              <IconFolder />
            </div>
            <p className="item-grid-title">Reveal in Finder</p>
          </div>
        )}
      </div>
    </section>
  );
}

interface HeroItemProps {
  items: ShelfItemRecord[];
  item: ShelfItemRecord;
  heroMode: HeroMode;
  isImporting: boolean;
  isExporting: boolean;
  dragLocked: boolean;
  onExportStart(): void;
  onExportEnd(): void;
  onOpenItemSheet(): void;
}

function HeroItem({
  items,
  item,
  heroMode,
  isImporting,
  isExporting,
  dragLocked,
  onExportStart,
  onExportEnd,
  onOpenItemSheet,
}: HeroItemProps) {
  const previewSrc = getHeroPreviewSource(item);
  const exportableItems = getExportableItems(items);
  const canDragOut = exportableItems.length > 0 && !dragLocked && !isImporting;
  const statusLabel = isImporting ? 'Importing…' : getHeroCountLabel(items, heroMode);
  const collageItems = heroMode === 'collage' ? items.slice(0, 3).map((entry, index) => ({ item: entry, index })) : [];
  const stackLayers = heroMode === 'stack' ? items.slice(0, Math.min(3, items.length)) : [];
  const dragLabel =
    exportableItems.length > 1
      ? `Drag out ${exportableItems.length} items`
      : exportableItems.length === 1
        ? `Drag out ${exportableItems[0]!.title}`
        : undefined;

  function handleHeroDragStart(event: React.DragEvent<HTMLDivElement>) {
    if (!canDragOut) {
      return;
    }

    event.preventDefault();
    const didStartDrag =
      exportableItems.length === 1
        ? window.ledge.startItemDrag(exportableItems[0]!.id)
        : window.ledge.startItemsDrag(exportableItems.map((entry) => entry.id));

    if (didStartDrag) {
      onExportStart();
      window.ledge.clearShelf();
    } else {
      onExportEnd();
    }
  }

  return (
    <div
      className={`hero-item is-${heroMode}${canDragOut ? ' is-draggable' : ''}${isExporting ? ' is-exporting' : ''}`}
      draggable={canDragOut}
      onDragStart={handleHeroDragStart}
      onDragEnd={() => {
        onExportEnd();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        window.ledge.showItemContextMenu(item.id);
      }}
      title={dragLabel}
    >
      <div className={`hero-stage is-${heroMode}${isExporting ? ' is-exporting' : ''}`}>
        {heroMode === 'collage' ? (
          <div className={`hero-collage${isExporting ? ' is-muted' : ''}`} aria-hidden="true">
            {collageItems.map(({ item: collageItem, index }) => {
              const src = getHeroPreviewSource(collageItem);
              const stackClassName = heroStackClassName(index, collageItems.length);
              return (
                <div key={collageItem.id} className={`hero-stack-card ${stackClassName}`}>
                  {src ? (
                    <img src={src} alt="" className="hero-stack-image" draggable={false} />
                  ) : (
                    <HeroGlyph kind={collageItem.kind} />
                  )}
                </div>
              );
            })}
          </div>
        ) : heroMode === 'stack' ? (
          <div className="hero-deck" aria-hidden="true">
            {stackLayers.slice(1, 3).map((entry, index) => (
              <div key={entry.id} className={`hero-deck-shadow hero-deck-shadow-${index + 1}`} />
            ))}
            <div className={`hero-artwork hero-artwork-deck ${isExporting ? 'is-exporting' : ''}`}>
              {previewSrc ? (
                <img src={previewSrc} alt="" className="hero-image" draggable={false} />
              ) : (
                <HeroGlyph kind={item.kind} />
              )}
            </div>
          </div>
        ) : (
          <div className={`hero-artwork ${isExporting ? 'is-exporting' : ''}`}>
            {previewSrc ? (
              <img src={previewSrc} alt="" className="hero-image" draggable={false} />
            ) : (
              <HeroGlyph kind={item.kind} />
            )}
          </div>
        )}

        {isExporting ? <div className="hero-export-veil" aria-hidden="true" /> : null}
      </div>

      <button
        className={`hero-count-button${isExporting ? ' is-exporting' : ''}`}
        onClick={onOpenItemSheet}
        disabled={items.length < 2}
        aria-label={`Show ${statusLabel}`}
      >
        <span>{statusLabel}</span>
        {items.length >= 2 ? <IconChevronDown /> : null}
      </button>
    </div>
  );
}

function HeroGlyph({ kind }: { kind: ShelfItemRecord['kind'] }) {
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M16 28a10 10 0 0 1 10-10h16l8 8h20a10 10 0 0 1 10 10v28a12 12 0 0 1-12 12H24A12 12 0 0 1 12 64V28h4Z"
          fill="rgba(255,255,255,0.96)"
        />
        <path
          d="M20 34h56a8 8 0 0 1 8 8v20a10 10 0 0 1-10 10H24A10 10 0 0 1 14 62V40a6 6 0 0 1 6-6Z"
          fill="rgba(230,232,235,0.95)"
        />
      </svg>
    );
  }

  if (kind === 'url') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M38 58l20-20m-7-10h8a16 16 0 1 1 0 32h-8m-6 0h-8a16 16 0 0 1 0-32h8"
          fill="none"
          stroke="rgba(255,255,255,0.96)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === 'text') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M28 16h30l18 18v42a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8Z" fill="rgba(255,255,255,0.96)" />
        <path d="M58 16v18h18" fill="rgba(225,228,232,0.95)" />
        <path d="M34 50h28M34 60h20" stroke="rgba(136,139,144,0.8)" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path
        d="M28 14h30l18 18v40a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10Z"
        fill="rgba(255,255,255,0.97)"
      />
      <path d="M58 14v18a8 8 0 0 0 8 8h18" fill="rgba(224,226,230,0.95)" />
      <path d="M34 56h24" stroke="rgba(206,210,216,0.9)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function getHeroPreviewSource(item: ShelfItemRecord): string | null {
  if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
    return null;
  }

  const path = item.file.resolvedPath || item.file.originalPath;
  if (!path || item.file.isMissing) {
    return null;
  }

  return `ledge-asset://preview?path=${encodeURIComponent(path)}`;
}

function heroStackClassName(index: number, count: number): string {
  if (count === 2) {
    return index === 0 ? 'hero-stack-card-front' : 'hero-stack-card-back-left';
  }

  if (index === 0) {
    return 'hero-stack-card-front';
  }

  return index === 1 ? 'hero-stack-card-back-left' : 'hero-stack-card-back-right';
}

function isActionableFileItem(
  item: ShelfItemRecord,
): item is Extract<ShelfItemRecord, { kind: 'file' | 'folder' | 'imageAsset' }> {
  return item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset';
}

function itemKindLabel(item: ShelfItemRecord): string {
  if (item.kind === 'imageAsset') {
    return 'Image';
  }

  if (item.kind === 'folder') {
    return 'Folder';
  }

  if (item.kind === 'file') {
    return 'File';
  }

  if (item.kind === 'url') {
    return 'Link';
  }

  return 'Text';
}

function isExternalTransfer(transfer: DataTransfer | null): boolean {
  if (!transfer) {
    return false;
  }

  const types = Array.from(transfer.types);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}

async function payloadsFromTransfer(transfer: DataTransfer): Promise<IngestPayload[]> {
  const payloads: IngestPayload[] = [];
  const droppedFiles = Array.from(transfer.files);
  const droppedItemFiles = Array.from(transfer.items as DataTransferItemList)
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const filePaths = [
    ...droppedFiles.map((file) => window.ledge.getFilePath(file)).filter((path): path is string => Boolean(path)),
    ...droppedItemFiles.map((file) => window.ledge.getFilePath(file)).filter((path): path is string => Boolean(path)),
    ...filePathsFromUriList(transfer.getData('text/uri-list')),
  ];

  if (filePaths.length > 0) {
    payloads.push({
      kind: 'fileDrop',
      paths: [...new Set(filePaths)],
    });
  }

  const imageItems = Array.from(transfer.items as DataTransferItemList).filter((item) =>
    item.type.startsWith('image/'),
  );
  for (const item of imageItems) {
    try {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }

      const maybePath = window.ledge.getFilePath(file);
      if (maybePath) {
        continue;
      }

      payloads.push(await imageToPayload(file));
    } catch {
      // Skip malformed image transfer items and continue ingesting the rest of the payload.
    }
  }

  if (payloads.length === 0) {
    const uriListPayload = urlPayloadFromUriList(transfer.getData('text/uri-list'));
    if (uriListPayload) {
      payloads.push({
        kind: 'url',
        ...uriListPayload,
      });
    }
  }

  const text = transfer.getData('text/plain').trim();
  if (text && payloads.length === 0) {
    try {
      const parsed = new URL(text);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        payloads.push({
          kind: 'url',
          url: parsed.toString(),
          label: parsed.hostname,
        });
      } else {
        payloads.push({
          kind: 'text',
          text,
        });
      }
    } catch {
      payloads.push({
        kind: 'text',
        text,
      });
    }
  }

  return payloads;
}

function filePathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('#'))
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        if (url.protocol !== 'file:') {
          return [];
        }

        return [decodeURIComponent(url.pathname)];
      } catch {
        return [];
      }
    });
}

function urlPayloadFromUriList(uriList: string): { url: string; label: string } | null {
  const firstEntry = uriList
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith('#'));

  if (!firstEntry) {
    return null;
  }

  try {
    const parsed = new URL(firstEntry);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return {
      url: parsed.toString(),
      label: parsed.hostname,
    };
  } catch {
    return null;
  }
}

async function imageToPayload(file: File): Promise<IngestPayload> {
  const dataUrl = await readFileAsDataUrl(file);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Image payload encoding failed.');
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeTypeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);

  return {
    kind: 'image',
    mimeType: file.type || mimeTypeMatch?.[1] || 'image/png',
    base64,
    filenameHint: file.name || 'drop-image',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read dropped image file.'));
    };

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Image file could not be encoded as data URL.'));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}
