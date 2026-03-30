import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  appStateSchema,
  preferencesRecordSchema,
  type AppState,
  type PermissionStatus,
  type PreferencePatch,
  type PreferencesRecord,
  type ShelfItemRecord,
  type ShelfOrigin,
  type ShelfRecord
} from '@shared/schema'

const persistedStateSchema = appStateSchema.omit({ permissionStatus: true })
const persistedStateEnvelopeSchema = persistedStateSchema.extend({
  version: z.literal(1)
})
const persistedStateVersion = 1

interface PersistedState {
  liveShelf: ShelfRecord | null
  recentShelves: ShelfRecord[]
  preferences: PreferencesRecord
}

interface LoadResult {
  state: PersistedState
  needsMigration: boolean
}

export class StateStore {
  readonly assetsDir: string
  readonly exportsDir: string
  private readonly statePath: string
  private persisted: PersistedState
  private pendingSerialized: string | null = null
  private writeScheduled = false
  private writeQueue = Promise.resolve()

  constructor(userDataDir: string) {
    this.assetsDir = join(userDataDir, 'assets')
    this.exportsDir = join(userDataDir, 'exports')
    this.statePath = join(userDataDir, 'state.json')
    mkdirSync(userDataDir, { recursive: true })
    mkdirSync(this.assetsDir, { recursive: true })
    mkdirSync(this.exportsDir, { recursive: true })
    const loaded = this.load()
    this.persisted = loaded.state

    if (loaded.needsMigration) {
      this.save()
    }
  }

  snapshot(permissionStatus: PermissionStatus): AppState {
    return appStateSchema.parse({
      ...this.persisted,
      permissionStatus
    })
  }

  getPreferences(): PreferencesRecord {
    return this.persisted.preferences
  }

  getRecentShelves(): ShelfRecord[] {
    return [...this.persisted.recentShelves]
  }

  getLiveShelf(): ShelfRecord | null {
    return this.persisted.liveShelf
  }

  whenIdle(): Promise<void> {
    return this.writeQueue
  }

  createShelf(origin: ShelfOrigin): ShelfRecord {
    this.archiveLiveShelf()
    this.persisted.liveShelf = {
      id: randomUUID(),
      name: defaultShelfName(),
      color: nextShelfColor(this.persisted.recentShelves.length),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin,
      items: []
    }
    this.save()
    return this.persisted.liveShelf
  }

  ensureLiveShelf(origin: ShelfOrigin): ShelfRecord {
    return this.persisted.liveShelf ?? this.createShelf(origin)
  }

  appendItems(items: ShelfItemRecord[]): ShelfRecord {
    const liveShelf = this.ensureLiveShelf('manual')
    const nextOrder = liveShelf.items.length
    liveShelf.items.push(
      ...items.map((item, index) => ({
        ...item,
        order: nextOrder + index
      }))
    )
    liveShelf.updatedAt = new Date().toISOString()
    this.save()
    return liveShelf
  }

  renameLiveShelf(name: string): ShelfRecord | null {
    if (!this.persisted.liveShelf) {
      return null
    }

    this.persisted.liveShelf.name = name.trim() || defaultShelfName()
    this.persisted.liveShelf.updatedAt = new Date().toISOString()
    this.save()
    return this.persisted.liveShelf
  }

  removeItem(itemId: string): ShelfRecord | null {
    if (!this.persisted.liveShelf) {
      return null
    }

    this.persisted.liveShelf.items = this.persisted.liveShelf.items
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({
        ...item,
        order: index
      }))
    this.persisted.liveShelf.updatedAt = new Date().toISOString()
    this.save()
    return this.persisted.liveShelf
  }

  clearLiveShelf(): ShelfRecord | null {
    if (!this.persisted.liveShelf) {
      return null
    }

    this.persisted.liveShelf.items = []
    this.persisted.liveShelf.updatedAt = new Date().toISOString()
    this.save()
    return this.persisted.liveShelf
  }

  reorderItems(itemIds: string[]): ShelfRecord | null {
    const liveShelf = this.persisted.liveShelf
    if (!liveShelf) {
      return null
    }

    const byId = new Map(liveShelf.items.map((item) => [item.id, item]))
    const reordered = itemIds
      .map((id) => byId.get(id))
      .filter((item): item is ShelfItemRecord => Boolean(item))

    const missing = liveShelf.items.filter((item) => !itemIds.includes(item.id))
    liveShelf.items = [...reordered, ...missing].map((item, index) => ({
      ...item,
      order: index
    }))
    liveShelf.updatedAt = new Date().toISOString()
    this.save()
    return liveShelf
  }

  replaceLiveShelf(shelf: ShelfRecord | null): void {
    this.persisted.liveShelf = shelf
    this.save()
  }

  closeShelf(): void {
    this.archiveLiveShelf()
    this.save()
  }

  restoreShelf(id: string): ShelfRecord | null {
    const shelf = this.persisted.recentShelves.find((entry) => entry.id === id)
    if (!shelf) {
      return null
    }

    this.archiveLiveShelf()
    this.persisted.recentShelves = this.persisted.recentShelves.filter((entry) => entry.id !== id)
    this.persisted.liveShelf = {
      ...shelf,
      origin: 'restore',
      updatedAt: new Date().toISOString()
    }
    this.save()
    return this.persisted.liveShelf
  }

  setPreferences(patch: PreferencePatch): PreferencesRecord {
    this.persisted.preferences = preferencesRecordSchema.parse({
      ...this.persisted.preferences,
      ...patch
    })
    this.save()
    return this.persisted.preferences
  }

  private archiveLiveShelf(): void {
    const liveShelf = this.persisted.liveShelf
    if (!liveShelf) {
      return
    }

    // Empty shelves are transient workspace, not recent history.
    if (liveShelf.items.length > 0) {
      const existing = this.persisted.recentShelves.filter((entry) => entry.id !== liveShelf.id)
      this.persisted.recentShelves = [liveShelf, ...existing].slice(0, 10)
    }

    this.persisted.liveShelf = null
  }

  private load(): LoadResult {
    if (!existsSync(this.statePath)) {
      return {
        state: this.defaultState(),
        needsMigration: false
      }
    }

    try {
      const raw = readFileSync(this.statePath, 'utf8')
      const parsed = JSON.parse(raw)

      if (parsed && typeof parsed === 'object' && 'version' in parsed) {
        const envelope = persistedStateEnvelopeSchema.parse(parsed)
        return {
          state: {
            liveShelf: envelope.liveShelf,
            recentShelves: envelope.recentShelves,
            preferences: envelope.preferences
          },
          needsMigration: false
        }
      }

      return {
        state: persistedStateSchema.parse(parsed),
        needsMigration: true
      }
    } catch {
      return {
        state: this.defaultState(),
        needsMigration: false
      }
    }
  }

  private save(): void {
    this.pendingSerialized = JSON.stringify(
      {
        version: persistedStateVersion,
        ...this.persisted
      },
      null,
      2
    )

    if (this.writeScheduled) {
      return
    }

    this.writeScheduled = true
    this.writeQueue = this.writeQueue.then(async () => {
      while (this.pendingSerialized !== null) {
        const serialized = this.pendingSerialized
        this.pendingSerialized = null

        try {
          await fs.writeFile(this.statePath, serialized, 'utf8')
        } catch (error) {
          console.error('Failed to persist Ledge state.', error)
        }
      }

      this.writeScheduled = false
    })
  }

  private defaultState(): PersistedState {
    return {
      liveShelf: null,
      recentShelves: [],
      preferences: preferencesRecordSchema.parse({})
    }
  }
}

function defaultShelfName(): string {
  const now = new Date()
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(now)

  return `Shelf ${time}`
}

function nextShelfColor(seed: number): ShelfRecord['color'] {
  const colors: ShelfRecord['color'][] = ['ember', 'wave', 'forest', 'sand']
  return colors[seed % colors.length]
}
