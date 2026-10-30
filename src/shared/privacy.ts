export interface VaultState {
  /** plain: nothing sealed yet (first run, or a vault from before setup). sealed: stored encrypted. */
  mode: 'plain' | 'sealed'
  /** A sealed vault is locked until it is opened this session. */
  locked: boolean
  /** The passphrase also needs a keyfile. */
  keyfile: boolean
  /** Nothing exists yet: the first run, which needs setup. */
  empty: boolean
  /** Milliseconds until another attempt is allowed. */
  waitMs: number
  /** Wrong attempts since the last success. */
  failed: number
}

export interface Credentials {
  passphrase: string
  /** Path of a keyfile. The main process reads it; its contents never reach the interface. */
  keyfilePath?: string
}

export interface SetupRequest extends Credentials {
  callsign: string
}

export interface AuthResult {
  state: VaultState
  /** Present only when a new recovery key was just made (setup, upgrade, or replacement). Shown once. */
  recoveryKey?: string
}
