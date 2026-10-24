const TRAILING_SEPARATORS = /[\\/]+$/

export function nameStart(path: string): number {
  const trimmed = path.replace(TRAILING_SEPARATORS, '')
  return Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1
}

export function folderName(path: string): string {
  return path.slice(nameStart(path)).replace(TRAILING_SEPARATORS, '')
}
