import type { EchopetAPI } from './index'

declare global {
  interface Window {
    echopet: EchopetAPI
  }
}

export {}
