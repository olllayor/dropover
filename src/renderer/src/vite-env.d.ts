/// <reference types="vite/client" />

import type { DropoverAPI } from '@shared/ipc'

declare global {
  interface Window {
    dropover: DropoverAPI
  }
}

export {}
