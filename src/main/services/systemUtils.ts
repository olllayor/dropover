const MODIFIER_ALIASES = new Map<string, string>([
  ['alt', 'Alt'],
  ['altgr', 'AltGr'],
  ['cmd', 'Command'],
  ['command', 'Command'],
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['meta', 'Super'],
  ['option', 'Option'],
  ['shift', 'Shift'],
  ['super', 'Super']
])

const SPECIAL_KEYS = new Set<string>([
  'Backspace',
  'CapsLock',
  'Delete',
  'Down',
  'End',
  'Enter',
  'Escape',
  'Home',
  'Insert',
  'Left',
  'PageDown',
  'PageUp',
  'Return',
  'Right',
  'Space',
  'Tab',
  'Up'
])

const FUNCTION_KEY_PATTERN = /^F(?:[1-9]|1\d|2[0-4])$/i
const SINGLE_KEY_PATTERN = /^[A-Z0-9]$/i

export function normalizeGlobalShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .join('+')
}

export function validateGlobalShortcut(shortcut: string): string {
  const normalized = normalizeGlobalShortcut(shortcut)
  if (!normalized) {
    return ''
  }

  const tokens = normalized.split('+')
  const modifiers = new Set<string>()
  let keyToken = ''

  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES.get(token.toLowerCase())
    if (modifier) {
      if (modifiers.has(modifier)) {
        return 'Shortcut contains duplicate modifier keys.'
      }

      modifiers.add(modifier)
      continue
    }

    if (keyToken) {
      return 'Shortcut must contain only one non-modifier key.'
    }

    if (!isValidKeyToken(token)) {
      return `Shortcut key "${token}" is not supported.`
    }

    keyToken = normalizeKeyToken(token)
  }

  if (!keyToken) {
    return 'Shortcut needs a non-modifier key.'
  }

  return ''
}

export function isOpenPathSuccess(result: string): boolean {
  return result.trim().length === 0
}

export function urlToWebloc(url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>URL</key>\n  <string>${escapeXml(url)}</string>\n</dict>\n</plist>\n`
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isValidKeyToken(token: string): boolean {
  return SINGLE_KEY_PATTERN.test(token) || FUNCTION_KEY_PATTERN.test(token) || SPECIAL_KEYS.has(normalizeKeyToken(token))
}

function normalizeKeyToken(token: string): string {
  if (SINGLE_KEY_PATTERN.test(token)) {
    return token.toUpperCase()
  }

  if (FUNCTION_KEY_PATTERN.test(token)) {
    return token.toUpperCase()
  }

  const lower = token.toLowerCase()
  switch (lower) {
    case 'backspace':
      return 'Backspace'
    case 'capslock':
      return 'CapsLock'
    case 'delete':
      return 'Delete'
    case 'down':
      return 'Down'
    case 'end':
      return 'End'
    case 'enter':
      return 'Enter'
    case 'escape':
    case 'esc':
      return 'Escape'
    case 'home':
      return 'Home'
    case 'insert':
      return 'Insert'
    case 'left':
      return 'Left'
    case 'pagedown':
      return 'PageDown'
    case 'pageup':
      return 'PageUp'
    case 'return':
      return 'Return'
    case 'right':
      return 'Right'
    case 'space':
      return 'Space'
    case 'tab':
      return 'Tab'
    case 'up':
      return 'Up'
    default:
      return token
  }
}
