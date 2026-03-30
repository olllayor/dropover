import { describe, expect, it } from 'vitest'
import { isOpenPathSuccess, normalizeGlobalShortcut, urlToWebloc, validateGlobalShortcut } from './systemUtils'

describe('urlToWebloc', () => {
  it('escapes XML-sensitive URL characters', () => {
    const contents = urlToWebloc('https://example.com?q=a&b=<test>')

    expect(contents).toContain('https://example.com?q=a&amp;b=&lt;test&gt;')
  })
})

describe('validateGlobalShortcut', () => {
  it('accepts an empty shortcut to disable registration', () => {
    expect(validateGlobalShortcut('')).toBe('')
  })

  it('accepts a valid accelerator', () => {
    expect(validateGlobalShortcut(' CommandOrControl + Shift + Space ')).toBe('')
    expect(normalizeGlobalShortcut(' CommandOrControl + Shift + Space ')).toBe('CommandOrControl+Shift+Space')
  })

  it('rejects duplicate modifiers', () => {
    expect(validateGlobalShortcut('Command+Command+Space')).toBe('Shortcut contains duplicate modifier keys.')
  })

  it('rejects missing non-modifier keys', () => {
    expect(validateGlobalShortcut('Command+Shift')).toBe('Shortcut needs a non-modifier key.')
  })
})

describe('isOpenPathSuccess', () => {
  it('treats non-empty shell errors as failures', () => {
    expect(isOpenPathSuccess('')).toBe(true)
    expect(isOpenPathSuccess('The file could not be opened')).toBe(false)
  })
})
