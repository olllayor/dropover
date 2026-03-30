import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from './stateStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('StateStore', () => {
  it('archives non-empty live shelves into recents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-store-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.appendItems([
      {
        id: 'item-1',
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'Hello',
        subtitle: '',
        preview: {
          summary: 'Hello',
          detail: ''
        },
        text: 'Hello'
      }
    ])

    store.closeShelf()
    await store.whenIdle()

    expect(store.getLiveShelf()).toBeNull()
    expect(store.getRecentShelves()).toHaveLength(1)
  })

  it('restores a recent shelf into the live shelf slot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-restore-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    const live = store.createShelf('manual')
    store.appendItems([
      {
        id: 'item-1',
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'Hello',
        subtitle: '',
        preview: {
          summary: 'Hello',
          detail: ''
        },
        text: 'Hello'
      }
    ])
    store.closeShelf()

    const restored = store.restoreShelf(live.id)
    await store.whenIdle()

    expect(restored?.id).toBe(live.id)
    expect(store.getLiveShelf()?.items).toHaveLength(1)
    expect(store.getRecentShelves()).toHaveLength(0)
  })

  it('does not archive empty shelves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-empty-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.closeShelf()
    await store.whenIdle()

    expect(store.getLiveShelf()).toBeNull()
    expect(store.getRecentShelves()).toHaveLength(0)
  })

  it('migrates legacy persisted state to version 1 on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-legacy-'))
    tempDirs.push(dir)
    const statePath = join(dir, 'state.json')
    await writeFile(
      statePath,
      JSON.stringify({
        liveShelf: null,
        recentShelves: [],
        preferences: {}
      }),
      'utf8'
    )

    const store = new StateStore(dir)
    await store.whenIdle()
    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as { version: number; preferences: { globalShortcut: string } }

    expect(persisted.version).toBe(1)
    expect(persisted.preferences.globalShortcut).toBe('CommandOrControl+Shift+Space')
  })

  it('flushes the latest state after rapid successive mutations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-flush-'))
    tempDirs.push(dir)
    const statePath = join(dir, 'state.json')
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.renameLiveShelf('Pinned')
    store.setPreferences({
      launchAtLogin: true
    })
    store.closeShelf()
    await store.whenIdle()

    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
      version: number
      liveShelf: null
      preferences: { launchAtLogin: boolean }
    }

    expect(persisted.version).toBe(1)
    expect(persisted.liveShelf).toBeNull()
    expect(persisted.preferences.launchAtLogin).toBe(true)
  })
})
