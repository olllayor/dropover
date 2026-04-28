/// <reference types="vite/client" />

import type { LedgeAPI } from '@shared/ipc';

declare global {
  interface Window {
    ledge: LedgeAPI;
  }
}

export {};
