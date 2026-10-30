// Two small rules, kept pure so they can be tested without Electron.
//
// 1. The page never makes network requests. Janus's window loads from disk (or the dev server while developing);
//    anything else it tries to fetch is cancelled by the main process, whatever the page's own policy says. The AI
//    assistant talks to its provider from the main process, not from the page.
// 2. Only the app's own page may call the main process. A frame that is not Janus's page (a stray iframe, a page that
//    got navigated somewhere unexpected) is refused.

export function allowRequest(url: string, devOrigin?: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  switch (u.protocol) {
    case 'file:':
    case 'data:':
    case 'blob:':
      return true
    case 'devtools:':
      return !!devOrigin // only while developing
    case 'http:':
    case 'https:':
    case 'ws:':
    case 'wss:': {
      if (!devOrigin) return false
      const d = new URL(devOrigin)
      return u.hostname === d.hostname && u.port === d.port
    }
    default:
      return false
  }
}

/** The address of a page allowed to talk to the main process. */
export function trustedUrl(url: string, devOrigin?: string): boolean {
  if (url.startsWith('file://')) return true
  if (!devOrigin) return false
  try {
    const u = new URL(url)
    const d = new URL(devOrigin)
    return u.protocol === d.protocol && u.hostname === d.hostname && u.port === d.port
  } catch {
    return false
  }
}

/** Links that open in the person's own browser. Nothing but plain web addresses. */
export function safeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
