// Reader and analyzer for a game-code diff: what changed in the machine's software between two captures.
//
// Agents drop a unified diff (git diff, git format-patch, or `diff -u`) as evidence. This reads it and
// reports what it can see for certain, which files were added, deleted or changed, which type
// definitions disappeared, what new capabilities were added, whether character or entity data was
// touched. It does not decide whether any of that explains an incident; that is the analyst's call.
// Pure and deterministic.

import type { Finding } from './evidence'

export interface DiffFile {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary'
  added: number
  removed: number
  from?: string
}

export interface DiffAnalysis {
  files: DiffFile[]
  added: number
  removed: number
  removedDefinitions: string[]
  addedCapabilities: { label: string; where: string[] }[]
  dated: string | null
  summary: string[]
  findings: Finding[]
}

/** True when the text carries unified-diff structure, not just a stray "+++" somewhere. */
export function looksLikeDiff(text: string): boolean {
  const head = text.slice(0, 20_000)
  return (
    /^diff --git /m.test(head) ||
    (/^--- .+\r?\n\+\+\+ .+/m.test(head) && /^@@ .+ @@/m.test(head)) ||
    /^Index: .+\r?\n=+\r?\n--- /m.test(head)
  )
}

const DEFINITION = [
  /^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+)?(?:final\s+|abstract\s+|sealed\s+|partial\s+)*(?:class|interface|enum|struct|record|trait|object)\s+([A-Za-z_][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:pub\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/
]

// Capabilities that let code reach outside the game's own sandbox. Each is evidence of *what the code
// can now do*, not of intent. "label" is what the analyst reads.
const CAPABILITIES: { label: string; pattern: RegExp }[] = [
  { label: 'network access', pattern: /\b(socket\.|requests\.(get|post|put)|urllib|http\.client|HttpClient|HttpURLConnection|WebSocket|XMLHttpRequest|fetch\(|net\.connect|curl_easy|libcurl)/ },
  { label: 'process execution', pattern: /\b(os\.system|subprocess\.|Runtime\.getRuntime\(\)\.exec|ProcessBuilder|child_process|execve?\(|popen\(|system\()/ },
  { label: 'dynamic code or library loading', pattern: /\b(eval\(|exec\(|importlib|__import__|ClassLoader|defineClass|dlopen|LoadLibrary|System\.load|Assembly\.Load|loadstring)/ },
  { label: 'direct hardware or device access', pattern: /(\/dev\/(tty|mem|gpio|i2c|spi)|\bgpiozero\b|\bRPi\.GPIO\b|\bpyserial\b|serial\.Serial|\bmmap\()/ },
  { label: 'writes outside the game directory', pattern: /\b(open\([^)]*['"]\/(etc|home|var|usr|tmp)\b|FileOutputStream\(['"]\/|Files\.write\()/ }
]

const ENTITY_PATH = /(char|entity|entities|npc|sprite|player|enemy|boss|monster|creature|avatar|class|roster|unit)/i

function cleanPath(raw: string): string {
  let p = raw.trim().split('\t')[0]
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p.replace(/^[ab]\//, '')
}

export function analyseDiff(text: string): DiffAnalysis {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let added = 0
  let removed = 0
  const removedDefs = new Map<string, string>() // name -> file
  const addedDefs = new Set<string>()
  const caps = new Map<string, Set<string>>()
  let dated: string | null = null
  let newName: string | null = null

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i]

    if (dated === null) {
      const dateMatch = /^Date:\s+(.+)$/.exec(line)
      if (dateMatch) {
        const t = Date.parse(dateMatch[1])
        if (Number.isFinite(t)) dated = new Date(t).toISOString()
      }
    }

    const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (git) {
      current = { path: git[2], status: 'modified', added: 0, removed: 0 }
      if (git[1] !== git[2]) current.from = git[1]
      files.push(current)
      newName = null
      continue
    }
    if (line.startsWith('new file mode') && current) current.status = 'added'
    else if (line.startsWith('deleted file mode') && current) current.status = 'deleted'
    else if (line.startsWith('rename from ') && current) {
      current.status = 'renamed'
      current.from = line.slice(12)
    } else if (/^Binary files .* differ$|^GIT binary patch/.test(line)) {
      if (current) current.status = 'binary'
      else {
        const m = /^Binary files (.+) and (.+) differ$/.exec(line)
        if (m) files.push({ path: cleanPath(m[2]), status: 'binary', added: 0, removed: 0 })
      }
    }

    // plain `diff -u` has no "diff --git" line: the ---/+++ pair opens each file
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldP = cleanPath(line.slice(4))
      const newP = cleanPath(lines[i + 1].slice(4))
      if (!current || (newName !== null && newName !== newP) || !files.includes(current)) {
        if (!(current && current.path === newP)) {
          current = { path: newP === '/dev/null' ? oldP : newP, status: 'modified', added: 0, removed: 0 }
          files.push(current)
        }
      }
      if (oldP === '/dev/null' || /\b1970-01-01\b/.test(line)) current.status = 'added'
      if (newP === '/dev/null') {
        current.status = 'deleted'
        current.path = oldP
      }
      newName = newP
      i++
      continue
    }

    if (!current) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++
      current.added++
      const body = line.slice(1)
      for (const re of DEFINITION) {
        const m = re.exec(body)
        if (m) {
          addedDefs.add(m[1])
          break
        }
      }
      for (const cap of CAPABILITIES) {
        if (cap.pattern.test(body)) {
          if (!caps.has(cap.label)) caps.set(cap.label, new Set())
          caps.get(cap.label)?.add(current.path)
        }
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++
      current.removed++
      const body = line.slice(1)
      for (const re of DEFINITION) {
        const m = re.exec(body)
        if (m) {
          if (!removedDefs.has(m[1])) removedDefs.set(m[1], current.path)
          break
        }
      }
    }
  }

  // A definition that was removed and re-added (moved, reformatted) did not disappear.
  const gone = [...removedDefs.entries()].filter(([name]) => !addedDefs.has(name))
  const removedDefinitions = gone.map(([name, file]) => `${name} (${file})`)
  const addedCapabilities = [...caps.entries()].map(([label, where]) => ({ label, where: [...where] }))

  const findings: Finding[] = []
  const deleted = files.filter((f) => f.status === 'deleted')
  if (deleted.length > 0) {
    findings.push({
      severity: 'medium',
      title: `${deleted.length} ${deleted.length === 1 ? 'file' : 'files'} deleted`,
      detail: deleted.slice(0, 8).map((f) => f.path).join(', ') + (deleted.length > 8 ? ', …' : '')
    })
  }
  if (removedDefinitions.length > 0) {
    findings.push({
      severity: 'high',
      title: `${removedDefinitions.length} type or function ${removedDefinitions.length === 1 ? 'definition' : 'definitions'} removed and not re-added`,
      detail: removedDefinitions.slice(0, 10).join(', ') + (removedDefinitions.length > 10 ? ', …' : '')
    })
  }
  for (const cap of addedCapabilities) {
    findings.push({
      severity: 'medium',
      title: `New ${cap.label} added`,
      detail: `Added in ${cap.where.slice(0, 5).join(', ')}${cap.where.length > 5 ? ', …' : ''}. This shows what the code can now do, not why it was added.`
    })
  }
  const entityFiles = files.filter((f) => ENTITY_PATH.test(f.path))
  if (entityFiles.length > 0) {
    findings.push({
      severity: 'medium',
      title: `Character or entity data touched in ${entityFiles.length} ${entityFiles.length === 1 ? 'file' : 'files'}`,
      detail: entityFiles.slice(0, 8).map((f) => `${f.path} (${f.status}, +${f.added}/−${f.removed})`).join(', ')
    })
  }
  const binary = files.filter((f) => f.status === 'binary')
  if (binary.length > 0) {
    findings.push({
      severity: 'low',
      title: `${binary.length} binary ${binary.length === 1 ? 'file' : 'files'} changed`,
      detail: 'A text diff cannot show what changed inside them: ' + binary.slice(0, 6).map((f) => f.path).join(', ')
    })
  }
  if (files.length === 0) {
    findings.push({
      severity: 'high',
      title: 'No files found in the diff',
      detail: 'The text looks like a diff but no file headers could be read from it.'
    })
  }

  const summary = [
    `${files.length} ${files.length === 1 ? 'file' : 'files'} changed · +${added} −${removed} lines`,
    ...(removedDefinitions.length ? [`Removed: ${removedDefinitions.slice(0, 3).join(', ')}${removedDefinitions.length > 3 ? ', …' : ''}`] : [])
  ]
  return { files, added, removed, removedDefinitions, addedCapabilities, dated, summary, findings }
}
