import { z } from 'zod'

export const shelfColorSchema = z.enum(['ember', 'wave', 'forest', 'sand'])
export const shelfOriginSchema = z.enum(['shake', 'tray', 'shortcut', 'manual', 'restore'])
export const shakeSensitivitySchema = z.enum(['gentle', 'balanced', 'firm'])

export const fileRefSchema = z.object({
  originalPath: z.string(),
  bookmarkBase64: z.string().default(''),
  resolvedPath: z.string().default(''),
  isStale: z.boolean().default(false),
  isMissing: z.boolean().default(false)
})

const previewSchema = z.object({
  summary: z.string(),
  detail: z.string().default('')
})

const shelfItemBaseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  subtitle: z.string().default(''),
  preview: previewSchema
})

export const fileItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('file'),
  file: fileRefSchema,
  mimeType: z.string().default('application/octet-stream')
})

export const folderItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('folder'),
  file: fileRefSchema
})

export const imageAssetItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('imageAsset'),
  file: fileRefSchema,
  mimeType: z.string().default('image/png')
})

export const textItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  savedFilePath: z.string().optional()
})

export const urlItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('url'),
  url: z.string().url(),
  savedFilePath: z.string().optional()
})

export const shelfItemSchema = z.discriminatedUnion('kind', [
  fileItemSchema,
  folderItemSchema,
  imageAssetItemSchema,
  textItemSchema,
  urlItemSchema
])

export const shelfRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: shelfColorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  origin: shelfOriginSchema,
  items: z.array(shelfItemSchema)
})

export const preferencesRecordSchema = z.object({
  launchAtLogin: z.boolean().default(false),
  shakeEnabled: z.boolean().default(true),
  shakeSensitivity: shakeSensitivitySchema.default('balanced'),
  excludedBundleIds: z.array(z.string()).default([]),
  globalShortcut: z.string().default('CommandOrControl+Shift+Space')
})

export const permissionStatusSchema = z.object({
  nativeHelperAvailable: z.boolean().default(false),
  accessibilityTrusted: z.boolean().default(false),
  shakeReady: z.boolean().default(false),
  lastError: z.string().default(''),
  shortcutRegistered: z.boolean().default(false),
  shortcutError: z.string().default('')
})

export const appStateSchema = z.object({
  liveShelf: shelfRecordSchema.nullable(),
  recentShelves: z.array(shelfRecordSchema).max(10).default([]),
  preferences: preferencesRecordSchema,
  permissionStatus: permissionStatusSchema
})

export const fileDropPayloadSchema = z.object({
  kind: z.literal('fileDrop'),
  paths: z.array(z.string()).min(1)
})

export const textPayloadSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1)
})

export const urlPayloadSchema = z.object({
  kind: z.literal('url'),
  url: z.string().url(),
  label: z.string().default('')
})

export const imagePayloadSchema = z.object({
  kind: z.literal('image'),
  mimeType: z.string(),
  base64: z.string(),
  filenameHint: z.string().default('drop-image')
})

export const ingestPayloadSchema = z.discriminatedUnion('kind', [
  fileDropPayloadSchema,
  textPayloadSchema,
  urlPayloadSchema,
  imagePayloadSchema
])

export const createShelfInputSchema = z.object({
  reason: shelfOriginSchema
})

export const preferencePatchSchema = preferencesRecordSchema.partial()

export const nativePermissionStatusSchema = z.object({
  accessibilityTrusted: z.boolean().default(false)
})

export const nativeBookmarkResolveSchema = z.object({
  resolvedPath: z.string().default(''),
  isStale: z.boolean().default(false),
  isMissing: z.boolean().default(false)
})

export type AppState = z.infer<typeof appStateSchema>
export type CreateShelfInput = z.infer<typeof createShelfInputSchema>
export type FileRef = z.infer<typeof fileRefSchema>
export type IngestPayload = z.infer<typeof ingestPayloadSchema>
export type FileBackedShelfItem = z.infer<typeof fileItemSchema> | z.infer<typeof folderItemSchema> | z.infer<typeof imageAssetItemSchema>
export type PermissionStatus = z.infer<typeof permissionStatusSchema>
export type PreferencePatch = z.infer<typeof preferencePatchSchema>
export type PreferencesRecord = z.infer<typeof preferencesRecordSchema>
export type ShelfColor = z.infer<typeof shelfColorSchema>
export type ShelfItemRecord = z.infer<typeof shelfItemSchema>
export type ShelfOrigin = z.infer<typeof shelfOriginSchema>
export type ShelfRecord = z.infer<typeof shelfRecordSchema>
export type ShakeSensitivity = z.infer<typeof shakeSensitivitySchema>
