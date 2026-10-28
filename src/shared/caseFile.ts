export interface CaseReport {
  date: string
  title: string
  detail: string
  source: string
}

export const SUSPENSION = {
  reference: 'EIA/EXUN/SUS-01',
  effective: '2026-10-27',
  classification: 'Restricted',
  issuer: 'Government of Nuxeland'
} as const

export const CASE_FILE: readonly CaseReport[] = [
  {
    date: '2026-10-23',
    title: 'POI-1 seen at the cabinet',
    detail: 'Agents meet a figure they took for a cosplayer',
    source: 'Progress Assessment Log'
  },
  {
    date: '2026-10-24',
    title: 'Character class missing',
    detail: 'One class is absent from the game source',
    source: 'Progress Assessment Log'
  },
  {
    date: '2026-10-27',
    title: 'EXUN suspended',
    detail: `Notice ${SUSPENSION.reference}, findings inconclusive`,
    source: 'Suspension Notice'
  },
  {
    date: '2026-10-27',
    title: 'Vanishings reported worldwide',
    detail: 'Characters missing from arcades in other countries',
    source: 'Note from Nano'
  }
]
