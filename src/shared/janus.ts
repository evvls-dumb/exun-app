export interface JanusHeader {
  format: string
  machineId: string
  machineTitle: string
  site: string
  periodStart: string
  periodEnd: string
  timezone: string
  sampling: string
}

export interface HourlySample {
  at: string
  active: boolean
  cpuTempC: number
  airTempC: number
  cpuUtilPct: number
  cpuFreqMhz: number
  memoryUsedPct: number
  memoryMb: number
  railV: number
  currentA: number
  powerW: number
  fanPwmPct: number
  fanRpm: number
  uptimeH: number
  throttled: boolean
  gameActive: boolean
  storageFreeGb: number
}

export interface DailyActivity {
  date: string
  activeHours: number
  sessions: number
  players: number
  status: string
}

export interface PerformanceSample {
  date: string
  fps: number
  p95FrameMs: number
  inputLatencyMs: number
  droppedFrames: number
  loadPct: number
}

export interface NetworkSample {
  at: string
  rxKb: number
  txKb: number
  rxErrors: number
  txErrors: number
  linkUp: boolean
}

export interface PowerEvent {
  at: string
  railV: number
  status: string
  action: string
}

export interface StorageSample {
  at: string
  capacityGb: number
  usedGb: number
  freeGb: number
}

export interface ThermalEvent {
  at: string
  event: string
  cpuTempC: number
  fanPwmPct: number
  response: string
}

export interface MaintenanceRecord {
  at: string
  category: string
  work: string
  outcome: string
}

export interface JournalEntry {
  at: string
  host: string
  service: string
  level: string
  message: string
}

export interface JanusLog {
  header: JanusHeader
  hourly: HourlySample[]
  daily: DailyActivity[]
  performance: PerformanceSample[]
  network: NetworkSample[]
  power: PowerEvent[]
  storage: StorageSample[]
  thermal: ThermalEvent[]
  maintenance: MaintenanceRecord[]
  journal: JournalEntry[]
  skippedRows: number
}

export class JanusLogError extends Error {}

const FORMAT_PREFIX = 'JANUS-LOG/'
const SECTION = /^===== (BEGIN|END) ([A-Z_]+) =====$/
const JOURNAL_LINE = /^(\S+)\s+(\S+)\s+([\w.-]+)\[(\w+)\]:\s?(.*)$/

type Row = Record<string, string>

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

function readHeader(lines: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of lines) {
    if (SECTION.test(line)) break
    const split = line.indexOf('=')
    if (split > 0) fields[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  return fields
}

function toHeader(fields: Record<string, string>): JanusHeader {
  const format = fields['file_format'] ?? ''
  if (!format.startsWith(FORMAT_PREFIX)) {
    throw new JanusLogError('This is not a Janus logs file.')
  }
  return {
    format,
    machineId: fields['machine_id'] ?? 'unknown',
    machineTitle: fields['machine_title'] ?? 'Unknown machine',
    site: fields['site'] ?? 'Unknown site',
    periodStart: fields['period_start'] ?? '',
    periodEnd: fields['period_end'] ?? '',
    timezone: fields['timezone'] ?? '',
    sampling: fields['sampling'] ?? ''
  }
}

export function parseJanusHeader(text: string): JanusHeader {
  return toHeader(readHeader(text.split(/\r?\n/, 40)))
}

function readSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of lines) {
    const marker = SECTION.exec(line)
    if (marker) {
      current = marker[1] === 'BEGIN' ? [] : null
      if (current) sections.set(marker[2], current)
    } else if (current && line.trim()) {
      current.push(line)
    }
  }
  return sections
}

function readTable(lines: readonly string[] | undefined): Row[] {
  if (!lines || lines.length < 2) return []
  const columns = splitCsv(lines[0]).map((column) => column.trim())
  return lines.slice(1).map((line) => {
    const cells = splitCsv(line)
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]?.trim() ?? '']))
  })
}

export function parseJanusLog(text: string): JanusLog {
  const lines = text.split(/\r?\n/)
  const header = toHeader(readHeader(lines))
  const sections = readSections(lines)
  let skippedRows = 0

  function rows<T>(name: string, map: (row: Row, number: (key: string) => number) => T): T[] {
    return readTable(sections.get(name)).flatMap((row) => {
      let valid = true
      const number = (key: string) => {
        const value = Number(row[key])
        if (row[key] === '' || !Number.isFinite(value)) valid = false
        return value
      }
      const mapped = map(row, number)
      if (!valid || !row['timestamp']) {
        skippedRows += 1
        return []
      }
      return [mapped]
    })
  }

  const hourly = rows('HOURLY_TELEMETRY', (row, number) => ({
    at: row['timestamp'],
    active: row['cabinet_state'] === 'active',
    cpuTempC: number('cpu_temp_c'),
    airTempC: number('cabinet_air_temp_c_est'),
    cpuUtilPct: number('cpu_util_pct'),
    cpuFreqMhz: number('cpu_freq_mhz'),
    memoryUsedPct: number('memory_used_pct'),
    memoryMb: number('memory_capacity_mb'),
    railV: number('five_v_rail_est_v'),
    currentA: number('estimated_current_a'),
    powerW: number('estimated_power_w'),
    fanPwmPct: number('fan_pwm_pct'),
    fanRpm: number('fan_rpm_est'),
    uptimeH: number('uptime_h'),
    throttled: row['throttled_flag'] === '1',
    gameActive: row['game_runtime_active'] === '1',
    storageFreeGb: number('storage_available_gb_est')
  }))
  if (hourly.length === 0) {
    throw new JanusLogError('The logs file has no hourly telemetry.')
  }

  const journal = (sections.get('SYSTEM_JOURNAL') ?? []).flatMap((line) => {
    const match = JOURNAL_LINE.exec(line)
    if (!match) {
      skippedRows += 1
      return []
    }
    const [, at, host, service, level, message] = match
    return [{ at, host, service, level: level.toUpperCase(), message }]
  })

  return {
    header,
    hourly,
    daily: rows('CABINET_DAILY_ACTIVITY', (row, number) => ({
      date: row['timestamp'].slice(0, 10),
      activeHours: number('active_hours'),
      sessions: number('sessions_est'),
      players: number('players_est'),
      status: row['status']
    })),
    performance: rows('GAME_RUNTIME_PERFORMANCE', (row, number) => ({
      date: row['timestamp'].slice(0, 10),
      fps: number('frame_rate_est_fps'),
      p95FrameMs: number('p95_frame_ms_est'),
      inputLatencyMs: number('input_latency_ms_est'),
      droppedFrames: number('dropped_frames_est'),
      loadPct: number('load_index_pct')
    })),
    network: rows('NETWORK_HOURLY', (row, number) => ({
      at: row['timestamp'],
      rxKb: number('rx_kb'),
      txKb: number('tx_kb'),
      rxErrors: number('rx_errors'),
      txErrors: number('tx_errors'),
      linkUp: row['link_status'] === 'up'
    })),
    power: rows('POWER_MONITOR_EVENTS', (row, number) => ({
      at: row['timestamp'],
      railV: number('five_v_rail_est_v'),
      status: row['status'],
      action: row['action']
    })),
    storage: rows('STORAGE_MONTHLY', (row, number) => ({
      at: row['timestamp'],
      capacityGb: number('capacity_gb'),
      usedGb: number('used_gb'),
      freeGb: number('free_gb')
    })),
    thermal: rows('THERMAL_EVENTS', (row, number) => ({
      at: row['timestamp'],
      event: row['event'],
      cpuTempC: number('cpu_temp_c'),
      fanPwmPct: number('fan_pwm_pct'),
      response: row['response']
    })),
    maintenance: rows('MAINTENANCE', (row) => ({
      at: row['timestamp'],
      category: row['category'],
      work: row['work'],
      outcome: row['outcome']
    })),
    journal,
    skippedRows
  }
}
