const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

export interface NormalizedBundleIds {
  normalized: string[]
  invalid: string[]
}

export function normalizeExcludedBundleIds(values: string[]): NormalizedBundleIds {
  const normalized: string[] = []
  const invalid: string[] = []
  const seenValid = new Set<string>()
  const seenInvalid = new Set<string>()

  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) {
      continue
    }

    if (!BUNDLE_ID_PATTERN.test(value)) {
      if (!seenInvalid.has(value)) {
        invalid.push(value)
        seenInvalid.add(value)
      }
      continue
    }

    if (seenValid.has(value)) {
      continue
    }

    seenValid.add(value)
    normalized.push(value)
  }

  return {
    normalized,
    invalid
  }
}
