import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema';
import {
  getExportableItems,
  getHeroCountLabel,
  getHeroMode,
  type HeroMode,
  type MenuTarget,
  type SessionMode,
} from './shelfFlow';

interface ShelfViewProps {
  state: AppState;
}

interface OverflowAction {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect(): Promise<void> | void;
}

export function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelf;
  const items = liveShelf?.items ?? [];
  const primaryItem = items[0] ?? null;
  const itemCount = items.length;
  const heroMode = getHeroMode(items);
  const exportableItems = getExportableItems(items);
  const [isImporting, setIsImporting] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('idle');
  const [menuTarget, setMenuTarget] = useState<MenuTarget>('shelf');
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
    setMenuTarget('shelf');
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
    setMenuTarget('shelf');
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

      setMenuTarget('shelf');
      setSessionMode('idle');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setMenuTarget('shelf');
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
    setMenuTarget('shelf');
    setSessionMode('idle');

    try {
      if (!liveShelf) {
        await window.ledge.createShelf({ reason: 'manual' });
      }

      for (const payload of payloads) {
        await window.ledge.addPayload(payload);
      }
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
    setMenuTarget('shelf');
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
      setMenuTarget('shelf');
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

  function openOverflowMenu() {
    if (!liveShelf) {
      return;
    }

    setMenuTarget(primaryItem ? 'frontItem' : 'shelf');
    setSessionMode('menuOpen');
  }

  function openItemSheet() {
    setMenuTarget('shelf');
    setSessionMode('itemListOpen');
  }

  function closeTransientSurface() {
    dragDepthRef.current = 0;
    setMenuTarget('shelf');
    setSessionMode('idle');
  }

  const menuActions: OverflowAction[] = [];
  if (primaryItem) {
    if (isActionableFileItem(primaryItem)) {
      const missing = primaryItem.file.isMissing;
      menuActions.push(
        {
          id: 'quick-look',
          label: 'Quick Look',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.previewItem(primaryItem.id);
          },
        },
        {
          id: 'reveal',
          label: 'Reveal in Finder',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.revealItem(primaryItem.id);
          },
        },
        {
          id: 'open',
          label: 'Open',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.openItem(primaryItem.id);
          },
        },
        {
          id: 'share-all',
          label: 'Share All',
          disabled: exportableItems.length === 0,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.shareShelfItems();
          },
        },
      );
    } else if (primaryItem.kind === 'text' || primaryItem.kind === 'url') {
      menuActions.push(
        {
          id: 'copy',
          label: 'Copy',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.copyItem(primaryItem.id);
          },
        },
        {
          id: 'save',
          label: 'Save',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.saveItem(primaryItem.id);
          },
        },
      );

      if (primaryItem.kind === 'url') {
        menuActions.push({
          id: 'open-url',
          label: 'Open',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.openItem(primaryItem.id);
          },
        });
      }
    }
  }

  if (liveShelf) {
    menuActions.push({
      id: 'show-items',
      label: 'Show Items',
      disabled: itemCount < 2,
      onSelect: () => {
        openItemSheet();
      },
    });

    menuActions.push(
      {
        id: 'clear',
        label: 'Clear Shelf',
        destructive: true,
        disabled: itemCount === 0,
        onSelect: async () => {
          closeTransientSurface();
          await window.ledge.clearShelf();
        },
      },
      {
        id: 'close',
        label: 'Close Shelf',
        onSelect: async () => {
          closeTransientSurface();
          await window.ledge.closeShelf();
        },
      },
    );
  }

  return (
    <main className="shelf-shell" onPaste={handlePaste} tabIndex={0}>
      <section
        className={`shelf-panel${isAcceptingDrop ? ' is-accepting-drop' : ''}${isExporting ? ' is-exporting' : ''}${isItemListOpen ? ' has-item-sheet' : ''}`}
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
        <header className="shelf-topbar">
          <button
            className="chrome-button chrome-button-close"
            onClick={() => void window.ledge.closeShelf()}
            aria-label="Close shelf"
          >
            <CloseIcon />
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
            <MenuDotsIcon />
          </button>
        </header>

        {isMenuOpen && menuActions.length > 0 ? (
          <OverflowMenu actions={menuActions} menuRef={menuRef} menuTarget={menuTarget} />
        ) : null}

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
                setMenuTarget('shelf');
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

          {liveShelf && isItemListOpen ? (
            <ItemSheet items={items} sheetRef={itemSheetRef} onMove={moveItem} onClose={closeTransientSurface} />
          ) : null}
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
      </section>
    </main>
  );
}

interface ItemSheetProps {
  items: ShelfItemRecord[];
  sheetRef: RefObject<HTMLDivElement | null>;
  onMove(itemId: string, direction: -1 | 1): Promise<void>;
  onClose(): void;
}

function ItemSheet({ items, sheetRef, onMove, onClose }: ItemSheetProps) {
  return (
    <section ref={sheetRef} className="item-sheet" aria-label="Shelf items">
      <header className="item-sheet-header">
        <div>
          <p className="item-sheet-title">Items</p>
          <p className="item-sheet-copy">Reorder or remove without leaving the compact view.</p>
        </div>
        <button className="ghost-button small" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="item-sheet-list">
        {items.map((item, index) => (
          <ItemSheetRow
            key={item.id}
            item={item}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={onMove}
          />
        ))}
      </div>
    </section>
  );
}

interface ItemSheetRowProps {
  item: ShelfItemRecord;
  isFirst: boolean;
  isLast: boolean;
  onMove(itemId: string, direction: -1 | 1): Promise<void>;
}

function ItemSheetRow({ item, isFirst, isLast, onMove }: ItemSheetRowProps) {
  const fileBacked = isActionableFileItem(item);
  const missing = fileBacked && item.file.isMissing;
  const previewCopy = missing ? 'Missing from disk' : item.subtitle || item.preview.summary;

  return (
    <article
      className={`item-sheet-row${missing ? ' is-missing' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        window.ledge.showItemContextMenu(item.id);
      }}
    >
      <div className="item-sheet-copy-block">
        <span className="item-sheet-kind">{itemKindLabel(item)}</span>
        <div className="item-sheet-text">
          <p className="item-sheet-row-title">{item.title}</p>
          <p className="item-sheet-row-copy">{previewCopy}</p>
        </div>
      </div>
      <div className="item-sheet-controls">
        <button
          className="mini-button compact"
          onClick={() => void onMove(item.id, -1)}
          disabled={isFirst}
          aria-label="Move item up"
        >
          ↑
        </button>
        <button
          className="mini-button compact"
          onClick={() => void onMove(item.id, 1)}
          disabled={isLast}
          aria-label="Move item down"
        >
          ↓
        </button>
        <button
          className="mini-button compact destructive"
          onClick={() => void window.ledge.removeItem(item.id)}
          aria-label="Remove item"
        >
          ×
        </button>
      </div>
    </article>
  );
}

interface OverflowMenuProps {
  actions: OverflowAction[];
  menuRef: RefObject<HTMLDivElement | null>;
  menuTarget: MenuTarget;
}

function OverflowMenu({ actions, menuRef, menuTarget }: OverflowMenuProps) {
  return (
    <div
      ref={menuRef}
      className="overflow-menu"
      role="menu"
      aria-label={menuTarget === 'frontItem' ? 'Front item actions' : 'Shelf actions'}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          className={`overflow-menu-item${action.destructive ? ' is-destructive' : ''}`}
          onClick={() => void action.onSelect()}
          disabled={action.disabled}
          role="menuitem"
        >
          {action.label}
        </button>
      ))}
    </div>
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
        {items.length >= 2 ? <ChevronDownIcon /> : null}
      </button>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="18" cy="12" r="1.75" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
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
    ...droppedItemFiles
      .map((file) => window.ledge.getFilePath(file))
      .filter((path): path is string => Boolean(path)),
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
