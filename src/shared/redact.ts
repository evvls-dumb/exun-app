// Redaction: take identifying details out of text before it leaves the machine.
//
// Two places use it. When a case is shared with someone outside the investigation, the person chooses
// what to strip from the copy that travels. And when the AI agent is allowed to read a case, it can be
// limited to a redacted view. Both go through the same rules so what an agent previews is what is sent.
//
// Redaction is by pattern plus a list the agent supplies (people, hostnames, addresses). It is a
// safeguard, not a guarantee: a name that is not in the list and not in a recognised pattern will pass
// through. The preview exists so the person can see exactly what is in the copy before it goes.
//
// Hashes and chain heads are never redacted: they are integrity anchors, not personal data, and a
// recipient needs them to check the evidence. Pseudonyms are stable inside one pass, the same address
// is always [ip-1], so a redacted case still reads coherently.

export type RedactKind = 'email' | 'ip' | 'mac' | 'path' | 'secret' | 'phone' | 'listed'

export interface RedactOptions {
  email: boolean
  ip: boolean
  mac: boolean
  path: boolean
  secret: boolean
  phone: boolean
  /** Exact strings to replace (hostnames, examiner and agent names, addresses…). Case-insensitive. */
  listed: string[]
}

export const REDACT_ALL: RedactOptions = {
  email: true,
  ip: true,
  mac: true,
  path: true,
  secret: true,
  phone: true,
  listed: []
}

export const REDACT_KIND_LABELS: Record<RedactKind, string> = {
  email: 'email addresses',
  ip: 'IP addresses',
  mac: 'MAC addresses',
  path: 'user folders in paths',
  secret: 'keys and tokens',
  phone: 'phone numbers',
  listed: 'listed names and hosts'
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d]|\.\d)/g
const IPV6 = /(?<![:\w])(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}(?![:\w])/g
const MAC = /(?<![:\w-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![:\w-])/g
const WIN_USER = /([A-Za-z]:\\Users\\)([^\\/:*?"<>|\r\n\s]+)/g
const NIX_USER = /(\/(?:home|Users)\/)([^/\s:]+)/g
const SECRET = /\b(?:gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|(?:api|secret|token|passw(?:or)?d)[_-]?(?:key)?\s*[:=]\s*[^\s,;]{8,})/gi
const PHONE = /(?<![\w.])(?:\+\d{1,3}(?:[\s.-]?\(?\d{2,5}\)?){2,4}|\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4})(?![\w])/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Redaction {
  text: string
  counts: Partial<Record<RedactKind, number>>
}

/** Stateful so the same value always maps to the same pseudonym across every field in a case. */
export class Redactor {
  private readonly maps: Record<string, Map<string, string>> = {}
  readonly counts: Partial<Record<RedactKind, number>> = {}
  private readonly listed: RegExp | null

  constructor(private readonly options: RedactOptions) {
    const terms = [...new Set(options.listed.map((t) => t.trim()).filter((t) => t.length >= 2))].sort(
      (a, b) => b.length - a.length
    )
    this.listed = terms.length ? new RegExp(`(?<![\\w])(?:${terms.map(escapeRegExp).join('|')})(?![\\w])`, 'gi') : null
  }

  private pseudonym(kind: string, value: string, label: string): string {
    const map = (this.maps[kind] ??= new Map())
    const key = value.toLowerCase()
    let alias = map.get(key)
    if (!alias) {
      alias = `[${label}-${map.size + 1}]`
      map.set(key, alias)
    }
    return alias
  }

  private bump(kind: RedactKind): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1
  }

  apply(input: string): string {
    if (!input) return input
    let text = input
    const o = this.options
    // Order matters: secrets and emails first, so a key or an address is not half-eaten by a later rule.
    if (o.secret) {
      text = text.replace(SECRET, () => {
        this.bump('secret')
        return '[secret]'
      })
    }
    if (o.email) {
      text = text.replace(EMAIL, (m) => {
        this.bump('email')
        return this.pseudonym('email', m, 'email')
      })
    }
    if (o.mac) {
      text = text.replace(MAC, (m) => {
        this.bump('mac')
        return this.pseudonym('mac', m, 'mac')
      })
    }
    if (o.ip) {
      text = text.replace(IPV6, (m) => {
        this.bump('ip')
        return this.pseudonym('ip', m, 'ip')
      })
      text = text.replace(IPV4, (m) => {
        this.bump('ip')
        return this.pseudonym('ip', m, 'ip')
      })
    }
    if (o.path) {
      text = text.replace(WIN_USER, (_m, head: string) => {
        this.bump('path')
        return `${head}[user]`
      })
      text = text.replace(NIX_USER, (_m, head: string) => {
        this.bump('path')
        return `${head}[user]`
      })
    }
    if (o.phone) {
      text = text.replace(PHONE, (m) => {
        this.bump('phone')
        return this.pseudonym('phone', m, 'phone')
      })
    }
    if (this.listed) {
      text = text.replace(this.listed, (m) => {
        this.bump('listed')
        return this.pseudonym('listed', m, 'name')
      })
    }
    return text
  }
}

/** Count what a piece of text contains, without changing it. Used to warn at intake. */
export function scanForIdentifiers(text: string): Partial<Record<RedactKind, number>> {
  const r = new Redactor(REDACT_ALL)
  r.apply(text.length > 400_000 ? text.slice(0, 400_000) : text)
  return { ...r.counts }
}

export function describeCounts(counts: Partial<Record<RedactKind, number>>): string {
  const parts = (Object.keys(counts) as RedactKind[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${counts[k]} ${REDACT_KIND_LABELS[k]}`)
  return parts.join(', ')
}
