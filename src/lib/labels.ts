import type { Sample } from './sensor'

export type LabeledRange = {
  id: string
  label: string
  startIndex: number
  endIndex: number
  startTimeSec: number
  endTimeSec: number
  durationSec: number
  sampleCount: number
}

export function rangeColors(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0
  }

  const hue = Math.abs(hash) % 360
  return {
    fill: `hsla(${hue} 70% 54% / 0.16)`,
    border: `hsla(${hue} 70% 36% / 0.48)`,
  }
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function parseOptionalNumber(value: string | undefined) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function findNearestIndexByTime(points: Sample[], targetTime: number) {
  if (!points.length) return 0
  let left = 0
  let right = points.length - 1

  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (points[mid].t < targetTime) {
      left = mid + 1
    } else {
      right = mid
    }
  }

  if (left === 0) return 0
  const prev = left - 1
  const leftDiff = Math.abs(points[left].t - targetTime)
  const prevDiff = Math.abs(points[prev].t - targetTime)
  return leftDiff <= prevDiff ? left : prev
}

export function sortLabeledRanges(ranges: LabeledRange[]) {
  return [...ranges].sort((a, b) => {
    const byStartTime = a.startTimeSec - b.startTimeSec
    if (Math.abs(byStartTime) > 1e-9) return byStartTime

    const byEndTime = a.endTimeSec - b.endTimeSec
    if (Math.abs(byEndTime) > 1e-9) return byEndTime

    const byStartIndex = a.startIndex - b.startIndex
    if (byStartIndex !== 0) return byStartIndex

    return a.label.localeCompare(b.label)
  })
}

export function parseLabeledRangesCsv(text: string, points: Sample[]) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return [] as LabeledRange[]

  const header = parseCsvLine(lines[0]).map((column) => column.replace(/^\uFEFF/, '').toLowerCase())
  const labelCol = header.indexOf('label')
  const startIndexCol = header.indexOf('startindex')
  const endIndexCol = header.indexOf('endindex')
  const startTimeCol = header.indexOf('starttimesec')
  const endTimeCol = header.indexOf('endtimesec')

  if (labelCol < 0) {
    throw new Error('Labels CSV must include a "label" column.')
  }
  if (startIndexCol < 0 || endIndexCol < 0) {
    if (startTimeCol < 0 || endTimeCol < 0) {
      throw new Error('Labels CSV must include start/end index or start/end time columns.')
    }
  }

  if (!points.length) return [] as LabeledRange[]

  const imported: LabeledRange[] = []
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const row = parseCsvLine(lines[rowIndex])
    const label = row[labelCol]?.trim()
    if (!label) continue

    let startIndex = parseOptionalNumber(row[startIndexCol])
    let endIndex = parseOptionalNumber(row[endIndexCol])
    const startTimeRaw = parseOptionalNumber(row[startTimeCol])
    const endTimeRaw = parseOptionalNumber(row[endTimeCol])

    if (startIndex === null || endIndex === null) {
      if (startTimeRaw === null || endTimeRaw === null) continue
      startIndex = findNearestIndexByTime(points, startTimeRaw)
      endIndex = findNearestIndexByTime(points, endTimeRaw)
    }

    const clampedStart = Math.round(startIndex)
    const clampedEnd = Math.round(endIndex)
    const start = Math.max(0, Math.min(points.length - 1, Math.min(clampedStart, clampedEnd)))
    const end = Math.max(0, Math.min(points.length - 1, Math.max(clampedStart, clampedEnd)))

    const startTimeSec = startTimeRaw ?? points[start].t
    const endTimeSec = endTimeRaw ?? points[end].t

    imported.push({
      id: `import-${rowIndex}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      startIndex: start,
      endIndex: end,
      startTimeSec,
      endTimeSec,
      durationSec: Math.max(0, endTimeSec - startTimeSec),
      sampleCount: end - start + 1,
    })
  }

  return sortLabeledRanges(imported)
}
