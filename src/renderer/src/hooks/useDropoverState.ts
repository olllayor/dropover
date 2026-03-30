import { startTransition, useEffect, useState } from 'react'
import type { AppState } from '@shared/schema'

export function useDropoverState() {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!window.dropover) {
      setError('The Electron preload bridge did not load. Restart the app after rebuilding the preload script.')
      return
    }

    let active = true

    void window.dropover
      .getState()
      .then((nextState) => {
        if (active) {
          startTransition(() => {
            setState(nextState)
            setError('')
          })
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Failed to fetch app state from the main process.')
        }
      })

    const unsubscribe = window.dropover.subscribeState((nextState) => {
      if (!active) {
        return
      }

      startTransition(() => {
        setState(nextState)
        setError('')
      })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return {
    state,
    error
  }
}
