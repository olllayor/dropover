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

interface NativeHelperProcess extends EventEmitter {
  stdin: {
    write(chunk: string): boolean
  }
  stdout: EventEmitter & {
    setEncoding(encoding: BufferEncoding): void
  }
  stderr: EventEmitter
}

interface NativeAgentClientOptions {
  spawnProcess?: (binaryPath: string) => NativeHelperProcess
  resolveBinaryPath?: () => string | null
  restartDelayMs?: number
  maxRestartDelayMs?: number
  scheduleTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
}

export class NativeAgentClient extends EventEmitter {
  private readonly spawnProcess: (binaryPath: string) => NativeHelperProcess
  private readonly resolveBinaryPath: () => string | null
  private readonly baseRestartDelayMs: number
  private readonly maxRestartDelayMs: number
  private readonly scheduleTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  private child: NativeHelperProcess | null = null
  private nextId = 1
  private stdoutBuffer = ''
  private readonly pending = new Map<number, PendingRequest>()
  private gestureEnabled = false
  private lastPreferences: PreferencesRecord | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private nextRestartDelayMs: number
  private shouldRestart = false
  private status: NativePermissionSnapshot = {
    nativeHelperAvailable: false,
    accessibilityTrusted: false,
    shakeReady: false,
    lastError: ''
  }

  constructor(options: NativeAgentClientOptions = {}) {
    super()
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess
    this.resolveBinaryPath = options.resolveBinaryPath ?? resolveNativeBinary
    this.baseRestartDelayMs = options.restartDelayMs ?? 250
    this.maxRestartDelayMs = options.maxRestartDelayMs ?? 2_000
    this.scheduleTimeout = options.scheduleTimeout ?? setTimeout
    this.nextRestartDelayMs = this.baseRestartDelayMs
  }

  async start(): Promise<void> {
    this.shouldRestart = true
    await this.launchHelper()
  }

  private async launchHelper(): Promise<void> {
    const binaryPath = this.resolveBinaryPath()

    if (!binaryPath || !existsSync(binaryPath)) {
      this.updateStatus({
        nativeHelperAvailable: false,
        accessibilityTrusted: false,
        shakeReady: false,
        lastError: 'Native helper binary not found'
      })
      return
    }

    const child = this.spawnProcess(binaryPath)
    this.child = child
    this.stdoutBuffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.consumeStdout(String(chunk)))
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim()
      if (message) {
        this.updateStatus({
          lastError: message
        })
      }
    })
    child.on('exit', () => {
      this.handleChildUnavailable(child, this.status.lastError || 'Native helper exited unexpectedly')
    })
    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'Native helper failed unexpectedly'
      this.handleChildUnavailable(child, message)
    })

    this.updateStatus({
      nativeHelperAvailable: true,
      lastError: ''
    })

    try {
      const permission = await this.getPermissions()
      if (child !== this.child) {
        return
      }

      this.updateStatus({
        accessibilityTrusted: permission.accessibilityTrusted
      })

      this.nextRestartDelayMs = this.baseRestartDelayMs

      if (this.lastPreferences) {
        await this.configureGesture(this.lastPreferences)
      }
    } catch (error) {
      if (child !== this.child) {
        return
      }

      this.updateStatus({
        lastError: error instanceof Error ? error.message : 'Native helper failed during startup'
      })
    }
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
    this.updateStatus({
      accessibilityTrusted: parsed.accessibilityTrusted
    })
    return parsed
  }

  async openPermissionSettings(): Promise<boolean> {
    if (!this.child) {
      return false
    }

    try {
      await this.call('permissions.openSettings')
      return true
    } catch {
      return false
    }
  }

  async configureGesture(preferences: PreferencesRecord): Promise<void> {
    this.lastPreferences = preferences
    this.gestureEnabled = preferences.shakeEnabled

    if (!this.child) {
      this.updateStatus({})
      return
    }

    try {
      await this.call('gesture.start', {
        enabled: preferences.shakeEnabled,
        excludedBundleIds: preferences.excludedBundleIds,
        sensitivity: preferences.shakeSensitivity
      })
    } catch {
      // The helper may be restarting. Preserve the desired preference and let recovery reapply it.
    }

    this.updateStatus({})
  }

  async stopGesture(): Promise<void> {
    this.gestureEnabled = false

    if (!this.child) {
      this.updateStatus({})
      return
    }

    try {
      await this.call('gesture.stop')
    } catch {
      // Ignore helper transport failures while shutting gesture capture down.
    }

    this.updateStatus({})
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

      try {
        const message = JSON.parse(line) as JsonRpcResponse
        this.handleMessage(message)
      } catch (error) {
        this.updateStatus({
          lastError: `Malformed helper response ignored: ${error instanceof Error ? error.message : 'Unknown parse error'}`
        })
      }
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
      return Promise.reject(helperUnavailableError())
    }

    const child = this.child
    const id = this.nextId++
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch {
      return Promise.reject(helperUnavailableError())
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  private handleChildUnavailable(child: NativeHelperProcess, message: string): void {
    if (child !== this.child) {
      return
    }

    this.child = null
    this.stdoutBuffer = ''
    this.rejectPending(helperUnavailableError(message))
    this.updateStatus({
      nativeHelperAvailable: false,
      accessibilityTrusted: false,
      lastError: message
    })
    this.scheduleRestart()
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error)
    }

    this.pending.clear()
  }

  private scheduleRestart(): void {
    if (!this.shouldRestart || this.restartTimer) {
      return
    }

    const delay = this.nextRestartDelayMs
    this.restartTimer = this.scheduleTimeout(() => {
      this.restartTimer = null
      void this.launchHelper()
    }, delay)
    this.nextRestartDelayMs = Math.min(delay * 2, this.maxRestartDelayMs)
  }

  private updateStatus(patch: Partial<NativePermissionSnapshot>): void {
    const next: NativePermissionSnapshot = {
      ...this.status,
      ...patch,
      shakeReady: computeShakeReady({
        nativeHelperAvailable: patch.nativeHelperAvailable ?? this.status.nativeHelperAvailable,
        accessibilityTrusted: patch.accessibilityTrusted ?? this.status.accessibilityTrusted,
        gestureEnabled: this.gestureEnabled
      })
    }

    const changed =
      next.nativeHelperAvailable !== this.status.nativeHelperAvailable ||
      next.accessibilityTrusted !== this.status.accessibilityTrusted ||
      next.shakeReady !== this.status.shakeReady ||
      next.lastError !== this.status.lastError

    this.status = next

    if (changed) {
      this.emit('statusChanged', this.status)
    }
  }
}

function defaultSpawnProcess(binaryPath: string): NativeHelperProcess {
  return spawn(binaryPath, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams as NativeHelperProcess
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

export function computeShakeReady(input: {
  nativeHelperAvailable: boolean
  accessibilityTrusted: boolean
  gestureEnabled: boolean
}): boolean {
  return input.nativeHelperAvailable && input.accessibilityTrusted && input.gestureEnabled
}

function helperUnavailableError(message = 'Native helper is unavailable'): Error {
  return new Error(message)
}
