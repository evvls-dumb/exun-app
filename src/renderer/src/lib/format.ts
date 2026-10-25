const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

import { formatNumber } from '@shared/format'

export { formatNumber, formatShortDate } from '@shared/format'

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}

const longDateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

export function formatLongDate(isoDate: string): string {
  return longDateFormatter.format(new Date(isoDate))
}

export function formatSigned(value: number, digits = 1): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), digits)}`
}

export function formatListTime(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}
