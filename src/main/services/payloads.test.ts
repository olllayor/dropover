import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPayloadFromText, getFileBackedPath, isFileBackedItem, payloadToItems } from './payloads'

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
})

describe('detectPayloadFromText', () => {
  it('upgrades urls to url payloads', () => {
    expect(detectPayloadFromText('https://example.com/test').kind).toBe('url')
  })

  it('keeps regular text as text payloads', () => {
    expect(detectPayloadFromText('just a note').kind).toBe('text')
  })
})
