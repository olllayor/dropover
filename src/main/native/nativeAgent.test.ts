import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAgentClient, computeShakeReady } from './nativeAgent'

class MockStream extends EventEmitter {
  setEncoding(_encoding: BufferEncoding): void {}
}

class MockChildProcess extends EventEmitter {
  readonly stdout = new MockStream()
  readonly stderr = new MockStream()
  readonly methods: string[] = []
  readonly stdin = {
    write: vi.fn((chunk: string) => {
      const request = JSON.parse(chunk.trim()) as { id: number; method: string }
      this.methods.push(request.method)

      if (request.method === 'permissions.getStatus') {
        queueMicrotask(() => {
          this.stdout.emit(
            'data',
            `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { accessibilityTrusted: true } })}\n`
          )
        })
      }

      if (request.method === 'gesture.start') {
        queueMicrotask(() => {
          this.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: true })}\n`)
        })
      }

      return true
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('computeShakeReady', () => {
  it('requires helper availability, accessibility trust, and enabled gesture capture', () => {
    expect(
      computeShakeReady({
        nativeHelperAvailable: true,
        accessibilityTrusted: true,
        gestureEnabled: true
      })
    ).toBe(true)

    expect(
      computeShakeReady({
        nativeHelperAvailable: true,
        accessibilityTrusted: false,
        gestureEnabled: true
      })
    ).toBe(false)

    expect(
      computeShakeReady({
        nativeHelperAvailable: true,
        accessibilityTrusted: true,
        gestureEnabled: false
      })
    ).toBe(false)
  })

  it('ignores malformed helper stdout and continues processing later messages', async () => {
    const child = new MockChildProcess()
    const agent = new NativeAgentClient({
      spawnProcess: () => child,
      resolveBinaryPath: () => process.execPath
    })
    const dragEnded = vi.fn()
    agent.on('dragEnded', dragEnded)

    await agent.start()
    child.stdout.emit('data', 'not-json\n')
    child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', method: 'gesture.dragEnded', params: {} })}\n`)

    expect(agent.getStatus().lastError).toContain('Malformed helper response ignored')
    expect(dragEnded).toHaveBeenCalledTimes(1)
  })

  it('emits shakeDetected notifications from helper stdout', async () => {
    const child = new MockChildProcess()
    const agent = new NativeAgentClient({
      spawnProcess: () => child,
      resolveBinaryPath: () => process.execPath
    })
    const shakeDetected = vi.fn()
    agent.on('shakeDetected', shakeDetected)

    await agent.start()
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'gesture.shakeDetected',
        params: {
          x: 240,
          y: 120,
          displayId: 1,
          sourceBundleId: 'com.apple.finder'
        }
      })}\n`
    )

    expect(shakeDetected).toHaveBeenCalledWith({
      x: 240,
      y: 120,
      displayId: 1,
      sourceBundleId: 'com.apple.finder'
    })
  })

  it('rejects pending calls and restarts the helper with the latest preferences', async () => {
    vi.useFakeTimers()
    const firstChild = new MockChildProcess()
    const secondChild = new MockChildProcess()
    const spawnProcess = vi.fn<(binaryPath: string) => MockChildProcess>()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)
    const agent = new NativeAgentClient({
      spawnProcess,
      resolveBinaryPath: () => process.execPath,
      restartDelayMs: 50,
      maxRestartDelayMs: 50
    })

    await agent.start()
    await agent.configureGesture({
      launchAtLogin: false,
      shakeEnabled: true,
      shakeSensitivity: 'firm',
      excludedBundleIds: ['com.apple.finder'],
      globalShortcut: 'CommandOrControl+Shift+Space'
    })

    firstChild.stdin.write.mockImplementationOnce((chunk: string) => {
      const request = JSON.parse(chunk.trim()) as { method: string }
      firstChild.methods.push(request.method)
      return true
    })

    const pending = agent.createBookmark('/tmp/bookmark-me')
    firstChild.emit('exit')

    await expect(pending).rejects.toThrow('Native helper exited unexpectedly')
    await vi.advanceTimersByTimeAsync(50)

    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(secondChild.methods).toContain('permissions.getStatus')
    expect(secondChild.methods).toContain('gesture.start')
  })

  it('times out stalled helper calls and schedules a restart', async () => {
    vi.useFakeTimers()
    const firstChild = new MockChildProcess()
    const secondChild = new MockChildProcess()
    const spawnProcess = vi.fn<(binaryPath: string) => MockChildProcess>()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)
    const agent = new NativeAgentClient({
      spawnProcess,
      resolveBinaryPath: () => process.execPath,
      requestTimeoutMs: 25,
      restartDelayMs: 50,
      maxRestartDelayMs: 50
    })

    await agent.start()

    firstChild.stdin.write.mockImplementationOnce((chunk: string) => {
      const request = JSON.parse(chunk.trim()) as { method: string }
      firstChild.methods.push(request.method)
      return true
    })

    const pending = agent.createBookmark('/tmp/stall-me')
    const pendingExpectation = expect(pending).rejects.toThrow('Native helper request timed out: bookmarks.create')
    await vi.advanceTimersByTimeAsync(25)
    await pendingExpectation
    expect(agent.getStatus().lastError).toContain('timed out')
    await vi.advanceTimersByTimeAsync(50)

    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })
})
