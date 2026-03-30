import { describe, expect, it } from 'vitest'
import { computeShakeReady } from './nativeAgent'

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
})
