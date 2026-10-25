const shortDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})

const numberFormatters = new Map<number, Intl.NumberFormat>()

export function formatShortDate(isoDate: string): string {
  return shortDateFormatter.format(new Date(isoDate))
}

export function formatNumber(value: number, digits = 1): string {
  let formatter = numberFormatters.get(digits)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    })
    numberFormatters.set(digits, formatter)
  }
  return formatter.format(value)
}
