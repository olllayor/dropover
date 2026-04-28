import { useEffect, useState, type ReactNode } from 'react'
import type { AppState } from '@shared/schema'
import { normalizeExcludedBundleIds } from '@shared/preferences'

interface PreferencesViewProps {
  state: AppState
}

const sidebarItems: { label: string; icon: ReactNode }[] = [
  { label: 'Shelf Activation', icon: <IconArrowUpRight /> },
  { label: 'Shelf Interaction', icon: <IconSparkles /> },
  { label: 'General', icon: <IconGear /> },
  { label: 'Cloud Sharing', icon: <IconCloud /> },
  { label: 'Custom Actions', icon: <IconWrench /> },
  { label: 'Instant Actions', icon: <IconZap /> },
  { label: 'Folder Monitoring', icon: <IconFolderOpen /> },
  { label: 'Ledge Pro', icon: <IconStar /> }
]

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
      await window.ledge.setPreferences({
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
          {sidebarItems.map(({ label, icon }) => (
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
          <div className="settings-app-mark">
            <IconApp />
          </div>
          <p>Ledge {appVersion}</p>
        </div>
      </aside>

      <section className="settings-stage">
        <header className="settings-stage-head">
          <h1>General</h1>
        </header>

        <div className="settings-stack">
          <section className="settings-group">
            <SettingsLine title="Show in menu bar" trailing={<Toggle checked={true} onChange={() => {}} disabled />} />
            <SettingsLine title="Menu bar icon" trailing={
              <button className="settings-picker" type="button" disabled>
                <span>Traditional</span>
                <span className="settings-picker-caret"><IconChevronDown /></span>
              </button>
            } />
          </section>

          <section className="settings-group">
            <SettingsLine
              title="Launch at login"
              trailing={<Toggle checked={preferences.launchAtLogin} onChange={(checked) => void window.ledge.setPreferences({ launchAtLogin: checked })} />}
            />
            <SettingsLine title="Show in Dock" trailing={<Toggle checked={false} onChange={() => {}} disabled />} />
          </section>

          <section className="settings-group">
            <SettingsLine title="Application data" trailing={<button className="settings-cta" disabled>Manage…</button>} />
            <SettingsLine title="Disable online features" trailing={<Toggle checked={false} onChange={() => {}} disabled />} />
          </section>

          <section className="settings-group">
            <SettingsLine
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

          <section className="settings-group">
            <div className="settings-row settings-row-stack">
              <div>
                <p className="settings-row-title">Shelf activation</p>
                <p className="settings-row-copy">Configure the shortcut and shake gesture used to reveal the floating shelf.</p>
              </div>
            </div>

            <div className="settings-field">
              <label className="pref-label" htmlFor="shortcut-input">
                Global shortcut
              </label>
              <input
                id="shortcut-input"
                className="pref-input"
                value={shortcutDraft}
                onChange={(event) => setShortcutDraft(event.target.value)}
                onBlur={() => void window.ledge.setPreferences({ globalShortcut: shortcutDraft })}
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

            <SettingsLine
              title="Shake gesture"
              copy="Reveal the shelf with a cursor shake while dragging."
              trailing={<Toggle checked={preferences.shakeEnabled} onChange={(checked) => void window.ledge.setPreferences({ shakeEnabled: checked })} />}
            />

            <div className="settings-field">
              <label className="pref-label" htmlFor="sensitivity">
                Shake sensitivity
              </label>
              <select
                id="sensitivity"
                className="pref-input"
                value={preferences.shakeSensitivity}
                onChange={(event) =>
                  void window.ledge.setPreferences({
                    shakeSensitivity: event.target.value as AppState['preferences']['shakeSensitivity']
                  })
                }
              >
                <option value="gentle">Gentle</option>
                <option value="balanced">Balanced</option>
                <option value="firm">Firm</option>
              </select>
            </div>

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

          <section className="settings-group">
            <SettingsLine
              title="Native helper"
              copy={state.permissionStatus.nativeHelperAvailable ? 'Connected and ready.' : 'Unavailable right now.'}
              trailing={
                <span className={`settings-state-pill ${state.permissionStatus.nativeHelperAvailable ? 'is-good' : 'is-warn'}`}>
                  {state.permissionStatus.nativeHelperAvailable ? 'Online' : 'Missing'}
                </span>
              }
            />

            <SettingsLine
              title="Accessibility"
              copy={state.permissionStatus.accessibilityTrusted ? 'Granted for shake detection.' : 'Required if you want shake-to-open.'}
              trailing={
                <button className="settings-cta" onClick={() => void window.ledge.openPermissionSettings()}>
                  Open Settings…
                </button>
              }
            />

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

/* ── Icons ── */

function IconArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M17 7H7M17 7V17" />
    </svg>
  )
}

function IconSparkles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function IconCloud() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19c0-1.7-1.3-3-3-3h-11a3 3 0 0 1-3-3c0-1.9 1.4-3.4 3.2-3.6.2-2.7 2.5-4.9 5.3-4.9 2.3 0 4.3 1.5 5.1 3.6.5-.1 1-.2 1.5-.2 2.5 0 4.5 2 4.5 4.5 0 .4-.1.8-.2 1.2 1.4.8 2.4 2.3 2.4 4 0 2.5-2 4.4-4.5 4.4z" />
    </svg>
  )
}

function IconWrench() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function IconZap() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function IconFolderOpen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function IconApp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
      <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: '12px', height: '12px' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/* ── Components ── */

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
  title: string
  copy?: string
  trailing: ReactNode
}

function SettingsLine({ title, copy, trailing }: SettingsLineProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <div>
          <p className="settings-row-title">{title}</p>
          {copy ? <p className="settings-row-copy">{copy}</p> : null}
        </div>
      </div>
      {trailing}
    </div>
  )
}
