import type { PartialTheme } from '@nivo/theming'

export interface Palette {
  accent: string
  danger: string
  warn: string
  text: string
  muted: string
  border: string
  card: string
  raised: string
  ink: string
  mono: string
}

export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string) => styles.getPropertyValue(name).trim()
  return {
    accent: token('--color-accent-bright'),
    danger: token('--color-danger'),
    warn: token('--color-warn'),
    text: token('--color-text'),
    muted: token('--color-text-muted'),
    border: token('--color-border'),
    card: token('--color-card'),
    raised: token('--color-border-strong'),
    ink: token('--color-bg'),
    mono: token('--font-mono')
  }
}

export function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

export function chartTheme(palette: Palette): PartialTheme {
  const label = { fill: palette.muted, fontSize: 11, fontFamily: palette.mono }
  return {
    background: 'transparent',
    text: label,
    axis: {
      ticks: { text: label, line: { stroke: palette.border } },
      domain: { line: { stroke: palette.border } }
    },
    grid: { line: { stroke: palette.border, strokeDasharray: '4 4' } },
    crosshair: { line: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1, strokeDasharray: '2 3' } },
    tooltip: { container: { background: 'transparent', boxShadow: 'none', padding: 0, borderRadius: 0 } }
  }
}
