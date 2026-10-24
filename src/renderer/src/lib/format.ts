const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}
