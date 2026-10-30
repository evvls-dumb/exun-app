/** Small settings that must be readable while the vault is locked, so they live outside it. Not secret. */
export interface Prefs {
  /** Erase the vault after this many wrong passphrases in a row. 0 = never. Off by default: it protects against a
   *  stranger at your keyboard, and it can also be triggered by one. */
  wipeAfterFailures: 0 | 5 | 10 | 20
}

export const WIPE_CHOICES = [0, 5, 10, 20] as const

export const DEFAULT_PREFS: Prefs = { wipeAfterFailures: 0 }

export function normalisePrefs(raw: unknown): Prefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Prefs>
  return {
    wipeAfterFailures: (WIPE_CHOICES as readonly unknown[]).includes(r.wipeAfterFailures) ? (r.wipeAfterFailures as Prefs['wipeAfterFailures']) : 0
  }
}
