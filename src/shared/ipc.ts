import type {
  AppState,
  CreateShelfInput,
  IngestPayload,
  PermissionStatus,
  PreferencePatch,
  PreferencesRecord,
  ShelfRecord,
} from './schema';

export const IPC_CHANNELS = {
  getState: 'ledge:get-state',
  createShelf: 'ledge:create-shelf',
  restoreShelf: 'ledge:restore-shelf',
  addPayload: 'ledge:add-payload',
  closeShelf: 'ledge:close-shelf',
  getPreferences: 'ledge:get-preferences',
  setPreferences: 'ledge:set-preferences',
  getRecentShelves: 'ledge:get-recent-shelves',
  getPermissionStatus: 'ledge:get-permission-status',
  openPermissionSettings: 'ledge:open-permission-settings',
  startItemDrag: 'ledge:start-item-drag',
  startItemsDrag: 'ledge:start-items-drag',
  previewItem: 'ledge:preview-item',
  revealItem: 'ledge:reveal-item',
  openItem: 'ledge:open-item',
  copyItem: 'ledge:copy-item',
  saveItem: 'ledge:save-item',
  removeItem: 'ledge:remove-item',
  renameShelf: 'ledge:rename-shelf',
  clearShelf: 'ledge:clear-shelf',
  reorderItems: 'ledge:reorder-items',
  shareShelfItems: 'ledge:share-shelf-items',
  showItemContextMenu: 'ledge:show-item-context-menu',
  stateUpdated: 'ledge:state-updated',
} as const;

export type StateListener = (state: AppState) => void;

export interface LedgeAPI {
  getState(): Promise<AppState>;
  createShelf(input: CreateShelfInput): Promise<AppState>;
  restoreShelf(id: string): Promise<AppState>;
  addPayload(payload: IngestPayload): Promise<AppState>;
  closeShelf(): Promise<AppState>;
  getPreferences(): Promise<PreferencesRecord>;
  setPreferences(patch: PreferencePatch): Promise<PreferencesRecord>;
  getRecentShelves(): Promise<ShelfRecord[]>;
  getPermissionStatus(): Promise<PermissionStatus>;
  openPermissionSettings(): Promise<boolean>;
  startItemDrag(itemId: string): boolean;
  startItemsDrag(itemIds: string[]): boolean;
  previewItem(itemId: string): Promise<boolean>;
  revealItem(itemId: string): Promise<boolean>;
  openItem(itemId: string): Promise<boolean>;
  copyItem(itemId: string): Promise<boolean>;
  saveItem(itemId: string): Promise<boolean>;
  removeItem(itemId: string): Promise<AppState>;
  renameShelf(name: string): Promise<AppState>;
  clearShelf(): Promise<AppState>;
  reorderItems(itemIds: string[]): Promise<AppState>;
  shareShelfItems(itemIds?: string[]): Promise<boolean>;
  showItemContextMenu(itemId: string): Promise<boolean>;
  getFilePath(file: File): string;
  subscribeState(listener: StateListener): () => void;
}
