import type {
  AppState,
  CreateShelfInput,
  IngestPayload,
  PermissionStatus,
  PreferencePatch,
  PreferencesRecord,
  ShelfRecord
} from './schema'

export const IPC_CHANNELS = {
  getState: 'dropover:get-state',
  createShelf: 'dropover:create-shelf',
  restoreShelf: 'dropover:restore-shelf',
  addPayload: 'dropover:add-payload',
  closeShelf: 'dropover:close-shelf',
  getPreferences: 'dropover:get-preferences',
  setPreferences: 'dropover:set-preferences',
  getRecentShelves: 'dropover:get-recent-shelves',
  getPermissionStatus: 'dropover:get-permission-status',
  openPermissionSettings: 'dropover:open-permission-settings',
  startItemDrag: 'dropover:start-item-drag',
  startItemsDrag: 'dropover:start-items-drag',
  previewItem: 'dropover:preview-item',
  revealItem: 'dropover:reveal-item',
  openItem: 'dropover:open-item',
  copyItem: 'dropover:copy-item',
  saveItem: 'dropover:save-item',
  removeItem: 'dropover:remove-item',
  renameShelf: 'dropover:rename-shelf',
  clearShelf: 'dropover:clear-shelf',
  reorderItems: 'dropover:reorder-items',
  shareShelfItems: 'dropover:share-shelf-items',
  stateUpdated: 'dropover:state-updated'
} as const

export type StateListener = (state: AppState) => void

export interface DropoverAPI {
  getState(): Promise<AppState>
  createShelf(input: CreateShelfInput): Promise<AppState>
  restoreShelf(id: string): Promise<AppState>
  addPayload(payload: IngestPayload): Promise<AppState>
  closeShelf(): Promise<AppState>
  getPreferences(): Promise<PreferencesRecord>
  setPreferences(patch: PreferencePatch): Promise<PreferencesRecord>
  getRecentShelves(): Promise<ShelfRecord[]>
  getPermissionStatus(): Promise<PermissionStatus>
  openPermissionSettings(): Promise<boolean>
  startItemDrag(itemId: string): boolean
  startItemsDrag(itemIds: string[]): boolean
  previewItem(itemId: string): Promise<boolean>
  revealItem(itemId: string): Promise<boolean>
  openItem(itemId: string): Promise<boolean>
  copyItem(itemId: string): Promise<boolean>
  saveItem(itemId: string): Promise<boolean>
  removeItem(itemId: string): Promise<AppState>
  renameShelf(name: string): Promise<AppState>
  clearShelf(): Promise<AppState>
  reorderItems(itemIds: string[]): Promise<AppState>
  shareShelfItems(itemIds?: string[]): Promise<boolean>
  getFilePath(file: File): string
  subscribeState(listener: StateListener): () => void
}
