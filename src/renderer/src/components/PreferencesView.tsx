import { useEffect, useState, type ReactNode } from 'react'
import type { AppState } from '@shared/schema'
import { normalizeExcludedBundleIds } from '@shared/preferences'

interface PreferencesViewProps {
  state: AppState
}

const sidebarItems = [
  ['↗', 'Shelf Activation'],
  ['✦', 'Shelf Interaction'],
  ['◎', 'General'],
  ['☁', 'Cloud Sharing'],
  ['⚙', 'Custom Actions'],
  ['⚡', 'Instant Actions'],
  ['◔', 'Folder Monitoring'],
  ['★', 'Ledge Pro']
] as const

export function PreferencesView({ state }: PreferencesViewProps) {
  const preferences = state.preferences
  const [excludedText, setExcludedText] = useState(preferences.excludedBundleIds.join('\n'))
  const [excludedError, setExcludedError] = useState('')
  const [shortcutDraft, setShortcutDraft] = useState(preferences.globalShortcut)
  const appVersion = '0.1.0'

  useEffect(() => {
    setExcludedText(preferences.excludedBundleIds.join('\n'))
    setExcludedError('')
  }, [preferences.excludedBundleIds])

  useEffect(() => {
    setShortcutDraft(preferences.globalShortcut)
  }, [preferences.globalShortcut])

  const shortcutStatus = !preferences.globalShortcut
    ? 'Shortcut disabled'
    : state.permissionStatus.shortcutRegistered
      ? 'Shortcut active'
      : 'Shortcut unavailable'

  async function saveExcludedApps() {
    const { normalized, invalid } = normalizeExcludedBundleIds(excludedText.split('\n'))
    if (invalid.length > 0) {
      setExcludedError(
        invalid.length === 1
          ? `Invalid bundle identifier: ${invalid[0]}`
          : `Invalid bundle identifiers: ${invalid.join(', ')}`
      )
      return
    }

    setExcludedError('')
    setExcludedText(normalized.join('\n'))

    try {
      await window.dropover.setPreferences({
        excludedBundleIds: normalized
      })
    } catch (error) {
      setExcludedError(error instanceof Error ? error.message : 'Failed to save excluded apps.')
    }
  }

  return (
    <main className="preferences-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">
          <p className="eyebrow">Settings</p>
        </div>

        <nav className="settings-nav" aria-label="Preference groups">
          {sidebarItems.map(([icon, label]) => (
            <button
              key={label}
              className={`settings-nav-item ${label === 'General' ? 'is-active' : 'is-idle'}`}
              type="button"
              aria-current={label === 'General' ? 'page' : undefined}
            >
              <span className="settings-nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-sidebar-foot">
          <div className="settings-app-mark">▣</div>
          <p>Ledge {appVersion}</p>
        </div>
      </aside>

      <section className="settings-stage">
        <header className="settings-stage-head">
          <h1>General</h1>
        </header>

        <div className="settings-stack">
          <section className="settings-card">
            <SettingsLine icon="▣" title="Show in menu bar" trailing={<Toggle checked={true} onChange={() => {}} disabled />} />

            <div className="settings-divider" />

            <SettingsLine
              icon="◌"
              title="Menu bar icon"
              trailing={
                <button className="settings-picker" type="button" disabled>
                  <span>Traditional</span>
                  <span className="settings-picker-caret">⌄</span>
                </button>
              }
            />
          </section>

          <section className="settings-card">
            <SettingsLine
              icon="◔"
              title="Launch at login"
              trailing={<Toggle checked={preferences.launchAtLogin} onChange={(checked) => void window.dropover.setPreferences({ launchAtLogin: checked })} />}
            />

            <div className="settings-divider" />

            <SettingsLine icon="▭" title="Show in Dock" trailing={<Toggle checked={false} onChange={() => {}} disabled />} />
          </section>

          <section className="settings-card">
            <SettingsLine icon="⌂" title="Application data" trailing={<button className="settings-cta" disabled>Manage…</button>} />

            <div className="settings-divider" />

            <SettingsLine icon="◎" title="Disable online features" trailing={<Toggle checked={false} onChange={() => {}} disabled />} />
          </section>

          <section className="settings-card">
            <SettingsLine
              icon="↪"
              title="Third party extensions"
              trailing={
                <div className="settings-actions">
                  <button className="settings-cta" disabled>
                    Install Alfred Workflow
                  </button>
                  <button className="settings-cta" disabled>
                    Install Raycast Extension
                  </button>
                </div>
              }
            />
          </section>

          <section className="settings-card">
            <div className="settings-row settings-row-stack">
              <div>
                <p className="settings-row-title">Shelf activation</p>
                <p className="settings-row-copy">Configure the shortcut and shake gesture used to reveal the floating shelf.</p>
              </div>
            </div>

            <div className="settings-divider" />

            <div className="settings-field">
              <label className="pref-label" htmlFor="shortcut-input">
                Global shortcut
              </label>
              <input
                id="shortcut-input"
                className="pref-input"
                value={shortcutDraft}
                onChange={(event) => setShortcutDraft(event.target.value)}
                onBlur={() => void window.dropover.setPreferences({ globalShortcut: shortcutDraft })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              <p className={`pref-status ${state.permissionStatus.shortcutError ? 'is-error' : ''}`}>
                {state.permissionStatus.shortcutError || shortcutStatus}
              </p>
            </div>

            <div className="settings-divider" />

            <SettingsLine
              icon="✦"
              title="Shake gesture"
              copy="Reveal the shelf with a cursor shake while dragging."
              trailing={<Toggle checked={preferences.shakeEnabled} onChange={(checked) => void window.dropover.setPreferences({ shakeEnabled: checked })} />}
            />

            <div className="settings-divider" />

            <div className="settings-field">
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

            <div className="settings-divider" />

            <div className="settings-field">
              <label className="pref-label" htmlFor="excluded-apps">
                Excluded apps
              </label>
              <textarea
                id="excluded-apps"
                className="pref-textarea"
                value={excludedText}
                onChange={(event) => {
                  setExcludedText(event.target.value)
                  if (excludedError) {
                    setExcludedError('')
                  }
                }}
                onBlur={() => void saveExcludedApps()}
                placeholder={'com.apple.finder\ncom.apple.FinalCut'}
              />
              <p className="pref-help">One macOS bundle identifier per line.</p>
              {excludedError ? <p className="pref-status is-error">{excludedError}</p> : null}
            </div>
          </section>

          <section className="settings-card">
            <SettingsLine
              icon="◉"
              title="Native helper"
              copy={state.permissionStatus.nativeHelperAvailable ? 'Connected and ready.' : 'Unavailable right now.'}
              trailing={
                <span className={`settings-state-pill ${state.permissionStatus.nativeHelperAvailable ? 'is-good' : 'is-warn'}`}>
                  {state.permissionStatus.nativeHelperAvailable ? 'Online' : 'Missing'}
                </span>
              }
            />

            <div className="settings-divider" />

            <SettingsLine
              icon="⌘"
              title="Accessibility"
              copy={state.permissionStatus.accessibilityTrusted ? 'Granted for shake detection.' : 'Required if you want shake-to-open.'}
              trailing={
                <button className="settings-cta" onClick={() => void window.dropover.openPermissionSettings()}>
                  Open Settings…
                </button>
              }
            />

            <div className="settings-divider" />

            <div className="settings-meta">
              <span>Shake status: {preferences.shakeEnabled ? (state.permissionStatus.shakeReady ? 'ready' : 'blocked') : 'disabled'}</span>
              <span>{state.preferences.excludedBundleIds.length} excluded apps</span>
            </div>
            {state.permissionStatus.lastError ? <p className="pref-status is-error">{state.permissionStatus.lastError}</p> : null}
          </section>
        </div>
      </section>
    </main>
  )
}

interface ToggleProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      className={`toggle ${checked ? 'is-on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      type="button"
    >
      <span />
    </button>
  )
}

interface SettingsLineProps {
  icon: string
  title: string
  copy?: string
  trailing: ReactNode
}

function SettingsLine({ icon, title, copy, trailing }: SettingsLineProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <span className="settings-row-icon">{icon}</span>
        <div>
          <p className="settings-row-title">{title}</p>
          {copy ? <p className="settings-row-copy">{copy}</p> : null}
        </div>
      </div>
      {trailing}
    </div>
  )
}
