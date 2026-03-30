import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPayloadFromText, getFileBackedPath, isFileBackedItem, payloadToItems, refreshFileRef } from './payloads'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('payloadToItems', () => {
  it('creates file-backed items from dropped paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-payload-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.txt')
    await writeFile(filePath, 'hello')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [filePath]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('file')
    expect(isFileBackedItem(items[0]!)).toBe(true)
    if (!isFileBackedItem(items[0]!)) {
      throw new Error('Expected file-backed item')
    }
    expect(getFileBackedPath(items[0])).toBe(filePath)
    expect(items[0]?.kind === 'file' ? items[0].mimeType : '').toBe('text/plain')
  })

  it('imports pathless images into app storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-image-'))
    tempDirs.push(dir)

    const items = await payloadToItems(
      {
        kind: 'image',
        mimeType: 'image/png',
        base64: Buffer.from('png-data').toString('base64'),
        filenameHint: 'dragged-image'
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items[0]?.kind).toBe('imageAsset')
    if (!isFileBackedItem(items[0]!)) {
      throw new Error('Expected imported image asset to be file-backed')
    }
    expect(getFileBackedPath(items[0])).toContain(dir)
  })

  it('skips invalid dropped paths without failing valid ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-partial-drop-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.txt')
    await writeFile(filePath, 'hello')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [filePath, join(dir, 'missing.txt')]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('file')
  })

  it('uses known MIME types and falls back safely for unknown extensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-mime-'))
    tempDirs.push(dir)
    const pdfPath = join(dir, 'sample.PDF')
    const unknownPath = join(dir, 'archive.weirdext')
    await writeFile(pdfPath, 'pdf')
    await writeFile(unknownPath, 'unknown')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [pdfPath, unknownPath]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    const fileItems = items.filter((item): item is Extract<(typeof items)[number], { kind: 'file' }> => item.kind === 'file')
    expect(fileItems.map((item) => item.mimeType)).toEqual(['application/pdf', 'application/octet-stream'])
  })
})

describe('detectPayloadFromText', () => {
  it('upgrades urls to url payloads', () => {
    expect(detectPayloadFromText('https://example.com/test').kind).toBe('url')
  })

  it('keeps regular text as text payloads', () => {
    expect(detectPayloadFromText('just a note').kind).toBe('text')
  })
})

describe('refreshFileRef', () => {
  it('marks missing non-bookmarked files as unavailable', async () => {
    const refreshed = await refreshFileRef(
      {
        originalPath: '/tmp/ledge-missing-item.txt',
        resolvedPath: '/tmp/ledge-missing-item.txt',
        bookmarkBase64: '',
        isStale: false,
        isMissing: false
      },
      {
        resolveBookmark: async () => ({
          resolvedPath: '',
          isStale: false,
          isMissing: true
        })
      }
    )

    expect(refreshed.isMissing).toBe(true)
    expect(refreshed.resolvedPath).toBe('')
  })
})
