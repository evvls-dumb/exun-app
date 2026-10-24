/// <reference types="vite/client" />

import type { JanusApi } from '@shared/api'

declare global {
  interface Window {
    janus: JanusApi
  }
}
