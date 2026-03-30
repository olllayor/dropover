import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  nativeBookmarkResolveSchema,
  nativePermissionStatusSchema,
  type PreferencesRecord,
  type ShakeSensitivity
} from '@shared/schema'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

export interface NativePermissionSnapshot {
  nativeHelperAvailable: boolean
  accessibilityTrusted: boolean
  shakeReady: boolean
  lastError: string
}

export interface ShakeDetectedEvent {
  x: number
  y: number
  displayId: number
  sourceBundleId: string
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

export class NativeAgentClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private stdoutBuffer = ''
  private readonly pending = new Map<number, PendingRequest>()
  private status: NativePermissionSnapshot = {
    nativeHelperAvailable: false,
    accessibilityTrusted: false,
    shakeReady: false,
    lastError: ''
  }

  async start(): Promise<void> {
    const binaryPath = resolveNativeBinary()

    if (!binaryPath || !existsSync(binaryPath)) {
      this.status = {
        nativeHelperAvailable: false,
        accessibilityTrusted: false,
        shakeReady: false,
        lastError: 'Native helper binary not found'
      }
      return
    }

    this.child = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.consumeStdout(chunk))
    this.child.stderr.on('data', (chunk) => {
      this.status.lastError = chunk.toString().trim()
    })
    this.child.on('exit', () => {
      this.status = {
        ...this.status,
        nativeHelperAvailable: false,
        shakeReady: false,
        lastError: this.status.lastError || 'Native helper exited unexpectedly'
      }
    })

    this.status.nativeHelperAvailable = true
    const permission = await this.getPermissions()
    this.status.accessibilityTrusted = permission.accessibilityTrusted
  }

  getStatus(): NativePermissionSnapshot {
    return this.status
  }

  async getPermissions(): Promise<{ accessibilityTrusted: boolean }> {
    if (!this.child) {
      return {
        accessibilityTrusted: false
      }
    }

    const result = await this.call('permissions.getStatus')
    const parsed = nativePermissionStatusSchema.parse(result)
    this.status.accessibilityTrusted = parsed.accessibilityTrusted
    this.status.shakeReady = this.status.nativeHelperAvailable
    return parsed
  }

  async openPermissionSettings(): Promise<boolean> {
    if (!this.child) {
      return false
    }

    await this.call('permissions.openSettings')
    return true
  }

  async configureGesture(preferences: PreferencesRecord): Promise<void> {
    if (!this.child) {
      return
    }

    await this.call('gesture.start', {
      enabled: preferences.shakeEnabled,
      excludedBundleIds: preferences.excludedBundleIds,
      sensitivity: preferences.shakeSensitivity
    })
    this.status.shakeReady = preferences.shakeEnabled
  }

  async stopGesture(): Promise<void> {
    if (!this.child) {
      return
    }

    await this.call('gesture.stop')
    this.status.shakeReady = false
  }

  async createBookmark(path: string): Promise<string> {
    if (!this.child) {
      return ''
    }

    const result = await this.call('bookmarks.create', { path })
    return typeof result === 'string' ? result : ''
  }

  async resolveBookmark(bookmarkBase64: string, originalPath: string): Promise<{
    resolvedPath: string
    isStale: boolean
    isMissing: boolean
  }> {
    if (!this.child || !bookmarkBase64) {
      return {
        resolvedPath: originalPath,
        isStale: false,
        isMissing: false
      }
    }

    const result = await this.call('bookmarks.resolve', {
      bookmarkBase64,
      originalPath
    })
    return nativeBookmarkResolveSchema.parse(result)
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk

    while (this.stdoutBuffer.includes('\n')) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n')
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      const message = JSON.parse(line) as JsonRpcResponse
      this.handleMessage(message)
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    if (message.id && this.pending.has(message.id)) {
      const request = this.pending.get(message.id)
      this.pending.delete(message.id)

      if (!request) {
        return
      }

      if (message.error) {
        request.reject(new Error(message.error.message))
        return
      }

      request.resolve(message.result)
      return
    }

    if (message.method === 'gesture.shakeDetected') {
      this.emit('shakeDetected', message.params as unknown as ShakeDetectedEvent)
      return
    }

    if (message.method === 'gesture.dragStarted') {
      this.emit('dragStarted', message.params ?? {})
      return
    }

    if (message.method === 'gesture.dragEnded') {
      this.emit('dragEnded', message.params ?? {})
    }
  }

  private call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error('Native helper is unavailable'))
    }

    const id = this.nextId++
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    this.child.stdin.write(`${JSON.stringify(payload)}\n`)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }
}

function resolveNativeBinary(): string | null {
  if (process.env.NODE_ENV === 'development') {
    return join(process.cwd(), 'native/bin/DropShelfNativeAgent')
  }

  if (process.resourcesPath) {
    return join(process.resourcesPath, 'native/DropShelfNativeAgent')
  }

  return null
}

export function sensitivityThresholds(sensitivity: ShakeSensitivity): {
  minimumReversals: number
  minimumDistance: number
} {
  switch (sensitivity) {
    case 'gentle':
      return { minimumReversals: 2, minimumDistance: 40 }
    case 'firm':
      return { minimumReversals: 4, minimumDistance: 88 }
    default:
      return { minimumReversals: 3, minimumDistance: 64 }
  }
}
