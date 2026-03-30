import { useEffect, useState } from 'react'
import type { AppState } from '@shared/schema'

interface PreferencesViewProps {
  state: AppState
}

export function PreferencesView({ state }: PreferencesViewProps) {
  const preferences = state.preferences
  const [excludedText, setExcludedText] = useState(preferences.excludedBundleIds.join('\n'))

  useEffect(() => {
    setExcludedText(preferences.excludedBundleIds.join('\n'))
  }, [preferences.excludedBundleIds])

  return (
    <main className="preferences-shell">
      <section className="preferences-hero">
        <div>
          <p className="eyebrow">Ledge preferences</p>
          <h1>Configure the shelf, not the clutter.</h1>
        </div>
        <p className="hero-copy">
          This first version stays narrow on purpose: a single live shelf, recent shelf restore, tray entry, shake activation,
          and copy-style drag-out for file-backed items.
        </p>
      </section>

      <section className="preferences-grid">
        <div className="pref-card">
          <p className="pref-label">Launch at login</p>
          <Toggle
            checked={preferences.launchAtLogin}
            onChange={(checked) => void window.dropover.setPreferences({ launchAtLogin: checked })}
          />
        </div>

        <div className="pref-card">
          <p className="pref-label">Shake gesture</p>
          <Toggle
            checked={preferences.shakeEnabled}
            onChange={(checked) => void window.dropover.setPreferences({ shakeEnabled: checked })}
          />
        </div>

        <div className="pref-card wide">
          <label className="pref-label" htmlFor="shortcut-input">
            Global shortcut
          </label>
          <input
            id="shortcut-input"
            className="pref-input"
            value={preferences.globalShortcut}
            onChange={(event) => void window.dropover.setPreferences({ globalShortcut: event.target.value })}
          />
          <p className="pref-help">Use Electron accelerator syntax. Example: <code>CommandOrControl+Shift+Space</code>.</p>
        </div>

        <div className="pref-card wide">
          <label className="pref-label" htmlFor="sensitivity">
            Shake sensitivity
          </label>
          <select
            id="sensitivity"
            className="pref-input"
            value={preferences.shakeSensitivity}
            onChange={(event) =>
              void window.dropover.setPreferences({
                shakeSensitivity: event.target.value as AppState['preferences']['shakeSensitivity']
              })
            }
          >
            <option value="gentle">Gentle</option>
            <option value="balanced">Balanced</option>
            <option value="firm">Firm</option>
          </select>
        </div>

        <div className="pref-card tall">
          <label className="pref-label" htmlFor="excluded-apps">
            Excluded apps
          </label>
          <textarea
            id="excluded-apps"
            className="pref-textarea"
            value={excludedText}
            onChange={(event) => setExcludedText(event.target.value)}
            onBlur={() =>
              void window.dropover.setPreferences({
                excludedBundleIds: excludedText
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
              })
            }
            placeholder={'com.apple.finder\ncom.apple.FinalCut'}
          />
          <p className="pref-help">One macOS bundle identifier per line.</p>
        </div>

        <div className="pref-card tall">
          <p className="pref-label">Helper status</p>
          <ul className="meta-list">
            <li>Native helper: {state.permissionStatus.nativeHelperAvailable ? 'connected' : 'missing'}</li>
            <li>Accessibility: {state.permissionStatus.accessibilityTrusted ? 'trusted' : 'not confirmed'}</li>
            <li>Shake ready: {state.permissionStatus.shakeReady ? 'yes' : 'no'}</li>
          </ul>
          <button className="ghost-button" onClick={() => void window.dropover.openPermissionSettings()}>
            Open accessibility settings
          </button>
        </div>

        <div className="pref-card wide">
          <p className="pref-label">Current boundaries</p>
          <ul className="meta-list">
            <li>Only one live shelf at a time.</li>
            <li>Recent shelves keep the most recent 10 non-empty shelves.</li>
            <li>File drag-out is copy/export semantics in v1.</li>
            <li>Text and URLs use copy, save, and open actions instead of native mixed drag-out.</li>
          </ul>
        </div>
      </section>
    </main>
  )
}

interface ToggleProps {
  checked: boolean
  onChange(checked: boolean): void
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      className={`toggle ${checked ? 'is-on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span />
    </button>
  )
}
