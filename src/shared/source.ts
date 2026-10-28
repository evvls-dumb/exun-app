export interface ClassInfo {
  name: string
  startLine: number
  endLine: number
  members: string[]
}

export type DiffKind = 'same' | 'removed' | 'added'

export interface DiffLine {
  kind: DiffKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export type UseKind = 'type' | 'member' | 'object'

export interface DanglingUse {
  name: string
  kind: UseKind
  line: number
  text: string
}

export interface SourceVersion {
  lines: string[]
  classes: ClassInfo[]
}

export interface SourceAnalysis {
  original: SourceVersion
  recovered: SourceVersion
  diff: DiffLine[]
  removedLines: number
  addedLines: number
  removedClasses: ClassInfo[]
  addedClasses: ClassInfo[]
  dangling: DanglingUse[]
  compiles: boolean
}

const CLASS_HEAD = /^\s*(?:class|struct)\s+([A-Za-z_]\w*)\b(?!.*;\s*$)/
const ACCESS = /^(?:public|private|protected)\s*:$/

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function code(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
}

function signature(line: string): string {
  return line
    .trim()
    .replace(/\s*:\s*[A-Za-z_]\w*\(.*$/, '')
    .replace(/\s*[{;].*$/, '')
    .trim()
}

function findClasses(lines: readonly string[]): ClassInfo[] {
  const classes: ClassInfo[] = []
  for (let start = 0; start < lines.length; start += 1) {
    const head = CLASS_HEAD.exec(code(lines[start]))
    if (!head) continue

    const members: string[] = []
    let depth = 0
    let opened = false
    let end = start
    for (let index = start; index < lines.length; index += 1) {
      const line = code(lines[index])
      const trimmed = line.trim()
      if (opened && depth === 1 && trimmed && !ACCESS.test(trimmed) && !trimmed.startsWith('}')) {
        const member = signature(line)
        if (member) members.push(member)
      }
      for (const char of line) {
        if (char === '{') {
          depth += 1
          opened = true
        } else if (char === '}') {
          depth -= 1
        }
      }
      end = index
      if (opened && depth === 0) break
    }

    classes.push({ name: head[1], startLine: start + 1, endLine: end + 1, members })
    start = end
  }
  return classes
}

function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const rows = before.length
  const columns = after.length
  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(columns + 1))
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[row][column] =
        before[row] === after[column]
          ? table[row + 1][column + 1] + 1
          : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }

  const diff: DiffLine[] = []
  let row = 0
  let column = 0
  while (row < rows || column < columns) {
    if (row < rows && column < columns && before[row] === after[column]) {
      diff.push({ kind: 'same', oldLine: row + 1, newLine: column + 1, text: before[row] })
      row += 1
      column += 1
    } else if (column < columns && (row === rows || table[row][column + 1] >= table[row + 1][column])) {
      diff.push({ kind: 'added', oldLine: null, newLine: column + 1, text: after[column] })
      column += 1
    } else {
      diff.push({ kind: 'removed', oldLine: row + 1, newLine: null, text: before[row] })
      row += 1
    }
  }
  return diff
}

export function analyseSource(originalText: string, recoveredText: string): SourceAnalysis {
  const original = splitLines(originalText)
  const recovered = splitLines(recoveredText)
  const originalClasses = findClasses(original)
  const recoveredClasses = findClasses(recovered)
  const recoveredNames = new Set(recoveredClasses.map((item) => item.name))
  const originalNames = new Set(originalClasses.map((item) => item.name))
  const removedClasses = originalClasses.filter((item) => !recoveredNames.has(item.name))
  const addedClasses = recoveredClasses.filter((item) => !originalNames.has(item.name))
  const diff = diffLines(original, recovered)

  const dangling = removedClasses.flatMap(({ name, members }) => {
    const type = new RegExp(`\\b${name}\\b`)
    const declared = new RegExp(`\\b${name}\\b\\s*[&*]?\\s*([A-Za-z_]\\w*)`, 'g')
    const objects = [...new Set(original.flatMap((text) => [...code(text).matchAll(declared)].map((match) => match[1])))]
    const methods = members
      .map((member) => /([A-Za-z_]\w*)\s*\(/.exec(member)?.[1])
      .filter((method): method is string => Boolean(method) && method !== name)
    const object = objects.length ? new RegExp(`\\b(?:${objects.join('|')})\\b`) : null
    const member = methods.length ? new RegExp(`\\.\\s*(?:${methods.join('|')})\\s*\\(`) : null

    return recovered.flatMap((text, index) => {
      const line = code(text)
      const kind: UseKind | null = type.test(line)
        ? 'type'
        : member?.test(line)
          ? 'member'
          : object?.test(line)
            ? 'object'
            : null
      return kind ? [{ name, kind, line: index + 1, text: text.trim() }] : []
    })
  })

  return {
    original: { lines: original, classes: originalClasses },
    recovered: { lines: recovered, classes: recoveredClasses },
    diff,
    removedLines: diff.filter((line) => line.kind === 'removed').length,
    addedLines: diff.filter((line) => line.kind === 'added').length,
    removedClasses,
    addedClasses,
    dangling,
    compiles: dangling.length === 0
  }
}
