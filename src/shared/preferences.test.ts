import { describe, expect, it } from 'vitest'
import { normalizeExcludedBundleIds } from './preferences'

describe('normalizeExcludedBundleIds', () => {
  it('trims, de-duplicates, and preserves valid bundle identifiers', () => {
    expect(
      normalizeExcludedBundleIds([
        ' com.apple.finder ',
        'com.apple.finder',
        '',
        'com.example.Dropover'
      ])
    ).toEqual({
      normalized: ['com.apple.finder', 'com.example.Dropover'],
      invalid: []
    })
  })

  it('reports invalid bundle identifiers separately', () => {
    expect(
      normalizeExcludedBundleIds([
        'finder',
        'com.apple finder',
        'com.apple._finder',
        'com.apple.finder'
      ])
    ).toEqual({
      normalized: ['com.apple.finder'],
      invalid: ['finder', 'com.apple finder', 'com.apple._finder']
    })
  })
})
