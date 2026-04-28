import { PreferencesView } from './components/PreferencesView'
import { ShelfView } from './components/ShelfView'
import { useDropoverState } from './hooks/useLedgeState'

export function App() {
  const { state, error } = useDropoverState()
  const view = new URLSearchParams(window.location.search).get('view') ?? 'shelf'

  if (error) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Renderer Error</p>
          <p>{error}</p>
        </div>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Ledge</p>
          <p>Loading shelf state…</p>
        </div>
      </main>
    )
  }

  if (view === 'preferences') {
    return <PreferencesView state={state} />
  }

  return <ShelfView state={state} />
}
