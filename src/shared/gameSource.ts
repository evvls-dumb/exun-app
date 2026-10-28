import original from './evidence/reckoning-original.cpp?raw'
import recovered from './evidence/reckoning-recovered.cpp?raw'
import { analyseSource } from './source'

export const GAME_SOURCE = {
  title: 'The Reckoning V: Origins',
  file: 'main.cpp',
  original: { label: 'Original', origin: 'Reference copy of the game source', text: original },
  recovered: { label: 'Recovered', origin: 'Pulled from the cabinet on Oct 24', text: recovered },
  recoveredOn: '2026-10-24'
} as const

export const SOURCE_ANALYSIS = analyseSource(GAME_SOURCE.original.text, GAME_SOURCE.recovered.text)
