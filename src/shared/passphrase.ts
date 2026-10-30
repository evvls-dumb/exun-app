// Passphrase guidance shared by setup screens and tests. Pure, no Node imports.

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: 'too short' | 'weak' | 'fair' | 'strong' | 'excellent'
  bits: number
  hint: string
}

const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'iloveyou', 'admin', 'janus', '123456', '12345678', 'abc123', 'monkey', 'dragon']

/** A deliberately plain estimate: length and variety, penalising repeats, runs and common words. It is a
 *  guide to choosing a long passphrase, not a guarantee. */
export function passphraseStrength(p: string): Strength {
  if (p.length < 8) return { score: 0, label: 'too short', bits: 0, hint: 'Use at least 8 characters; 4 or more random words is better.' }
  const lower = p.toLowerCase()
  let pool = 0
  if (/[a-z]/.test(p)) pool += 26
  if (/[A-Z]/.test(p)) pool += 26
  if (/\d/.test(p)) pool += 10
  if (/[^A-Za-z0-9]/.test(p)) pool += 33
  const unique = new Set(p).size
  let bits = Math.log2(pool || 1) * Math.min(p.length, unique * 2)
  const words = p.split(/[\s\-_.]+/).filter((w) => w.length >= 3)
  if (words.length >= 4) bits = Math.max(bits, words.length * 11) // diceware-style: ~11 bits a word
  if (COMMON.some((c) => lower.includes(c))) bits = Math.min(bits, 28)
  if (/(.)\1{2,}/.test(p) || /(0123|1234|2345|abcd|qwer|asdf)/i.test(p)) bits -= 12
  bits = Math.max(0, Math.round(bits))
  const score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4
  const label = (['too short', 'weak', 'fair', 'strong', 'excellent'] as const)[score]
  const hint = score >= 3 ? '' : 'Longer is stronger: try four or more unrelated words.'
  return { score: score as Strength['score'], label, bits, hint }
}

/** How long a guess-everything attack would take on average, in plain words. Assumes a billion guesses a
 *  second and ignores the deliberate slowness of the key derivation, so the real figure is far larger. */
export function crackTime(bits: number): string {
  const seconds = 2 ** Math.max(0, bits - 1) / 1e9
  const MIN = 60
  const HOUR = 3600
  const DAY = 86_400
  const YEAR = 31_557_600
  if (seconds < 1) return 'less than a second'
  if (seconds < MIN) return `about ${Math.round(seconds)} seconds`
  if (seconds < HOUR) return `about ${Math.round(seconds / MIN)} minutes`
  if (seconds < DAY) return `about ${Math.round(seconds / HOUR)} hours`
  if (seconds < YEAR) return `about ${Math.round(seconds / DAY)} days`
  const years = seconds / YEAR
  if (years < 1000) return `about ${Math.round(years)} years`
  if (years < 1e6) return `about ${(Math.round(years / 100) * 100).toLocaleString('en-US')} years`
  if (years < 1e9) return 'millions of years'
  return 'billions of years'
}

/** A random index below n with no modulo bias, from the platform's secure random source. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % n
  }
}

/** Random words from the EFF list, chosen with the secure random source. */
export function suggestPassphrase(words: readonly string[], count = 6): string {
  return Array.from({ length: count }, () => words[randomBelow(words.length)]).join(' ')
}
