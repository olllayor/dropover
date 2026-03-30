import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  type FileBackedShelfItem,
  type FileRef,
  type IngestPayload,
  type ShelfItemRecord,
  fileRefSchema
} from '@shared/schema'

export interface PayloadContext {
  assetsDir: string
  createBookmark(path: string): Promise<string>
  resolveBookmark(bookmarkBase64: string, originalPath: string): Promise<{
    resolvedPath: string
    isStale: boolean
    isMissing: boolean
  }>
}

export function isFileBackedItem(item: ShelfItemRecord): item is FileBackedShelfItem {
  return item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset'
}

export function getFileBackedPath(item: FileBackedShelfItem): string | null {
  if (!isFileBackedItem(item)) {
    return null
  }

  if (item.file.isMissing) {
    return null
  }

  return item.file.resolvedPath || item.file.originalPath || null
}

export function detectPayloadFromText(text: string): IngestPayload {
  const trimmed = text.trim()

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return {
        kind: 'url',
        url: url.toString(),
        label: trimmed
      }
    }
  } catch {
    // Fall through to plain text payload.
  }

  return {
    kind: 'text',
    text
  }
}

export async function payloadToItems(
  payload: IngestPayload,
  context: PayloadContext
): Promise<ShelfItemRecord[]> {
  switch (payload.kind) {
    case 'fileDrop':
      return createPathItems(payload.paths, context)
    case 'text':
      return [createTextItem(payload.text, 0)]
    case 'url':
      return [createUrlItem(payload.url, payload.label, 0)]
    case 'image':
      return [await createImageAssetItem(payload.base64, payload.mimeType, payload.filenameHint, context)]
  }
}

export async function refreshFileRef(
  file: FileRef,
  context: Pick<PayloadContext, 'resolveBookmark'>
): Promise<FileRef> {
  if (!file.bookmarkBase64) {
    const exists = await pathExists(file.originalPath)
    return fileRefSchema.parse({
      ...file,
      resolvedPath: exists ? file.originalPath : '',
      isMissing: !exists,
      isStale: false
    })
  }

  const resolved = await context.resolveBookmark(file.bookmarkBase64, file.originalPath)

  return fileRefSchema.parse({
    ...file,
    ...resolved
  })
}

async function createPathItems(paths: string[], context: PayloadContext): Promise<ShelfItemRecord[]> {
  const settled = await Promise.allSettled(paths.map(async (path, index) => createPathItem(path, index, context)))

  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

function createTextItem(text: string, order: number): ShelfItemRecord {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const title = lines[0]?.slice(0, 56) || 'Text snippet'

  return {
    id: randomUUID(),
    kind: 'text',
    createdAt: new Date().toISOString(),
    order,
    title,
    subtitle: `${text.length} characters`,
    preview: {
      summary: lines[0]?.slice(0, 72) || 'Plain text',
      detail: lines[1]?.slice(0, 72) || ''
    },
    text
  }
}

function createUrlItem(url: string, label: string, order: number): ShelfItemRecord {
  const parsed = new URL(url)
  const title = label || parsed.hostname.replace(/^www\./, '')

  return {
    id: randomUUID(),
    kind: 'url',
    createdAt: new Date().toISOString(),
    order,
    title,
    subtitle: parsed.toString(),
    preview: {
      summary: parsed.hostname,
      detail: parsed.pathname === '/' ? '' : parsed.pathname
    },
    url
  }
}

async function createPathItem(path: string, order: number, context: PayloadContext): Promise<ShelfItemRecord> {
  const stats = await fs.lstat(path)
  const bookmarkBase64 = await safeBookmark(path, context)
  const file = fileRefSchema.parse({
    originalPath: path,
    resolvedPath: path,
    bookmarkBase64,
    isStale: false,
    isMissing: false
  })

  if (stats.isDirectory()) {
    return {
      id: randomUUID(),
      kind: 'folder',
      createdAt: new Date().toISOString(),
      order,
      title: basename(path),
      subtitle: 'Folder',
      preview: {
        summary: 'Folder reference',
        detail: path
      },
      file
    }
  }

  const extension = extname(path).replace(/^\./, '').toUpperCase()

  return {
    id: randomUUID(),
    kind: 'file',
    createdAt: new Date().toISOString(),
    order,
    title: basename(path),
    subtitle: formatBytes(stats.size),
    preview: {
      summary: extension || 'File',
      detail: path
    },
    file,
    mimeType: lookupMimeType(path)
  }
}

async function createImageAssetItem(
  base64: string,
  mimeType: string,
  filenameHint: string,
  context: PayloadContext
): Promise<ShelfItemRecord> {
  const extension = mimeTypeToExtension(mimeType)
  const id = randomUUID()
  const assetPath = join(context.assetsDir, `${id}-${sanitizeFileName(filenameHint)}.${extension}`)
  const data = Buffer.from(base64, 'base64')
  await fs.writeFile(assetPath, data)
  const bookmarkBase64 = await safeBookmark(assetPath, context)

  return {
    id,
    kind: 'imageAsset',
    createdAt: new Date().toISOString(),
    order: 0,
    title: basename(assetPath),
    subtitle: formatBytes(data.byteLength),
    preview: {
      summary: mimeType,
      detail: 'Imported image asset'
    },
    mimeType,
    file: fileRefSchema.parse({
      originalPath: assetPath,
      resolvedPath: assetPath,
      bookmarkBase64,
      isStale: false,
      isMissing: false
    })
  }
}

function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function lookupMimeType(path: string): string {
  const extension = extname(path).replace(/^\./, '').toLowerCase()
  if (!extension) {
    return 'application/octet-stream'
  }

  return MIME_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-image'
}

async function safeBookmark(path: string, context: PayloadContext): Promise<string> {
  try {
    return await context.createBookmark(path)
  } catch {
    return ''
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  csv: 'text/csv',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  xml: 'application/xml',
  zip: 'application/zip'
}
