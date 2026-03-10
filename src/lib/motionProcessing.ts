import type { Sample } from './sensor'

export type MotionLabel = 'running' | 'swing'

export type MotionRange = {
  label: MotionLabel
  startIndex: number
  endIndex: number
  durationSec: number
  confidence: number
}

export const MOTION_COLORS: Record<MotionLabel, string> = {
  running: 'rgba(34, 197, 94, 0.14)',
  swing: 'rgba(59, 130, 246, 0.14)',
}

export const MOTION_BORDERS: Record<MotionLabel, string> = {
  running: 'rgba(22, 163, 74, 0.45)',
  swing: 'rgba(37, 99, 235, 0.45)',
}

function accelMagnitude(sample: Sample) {
  return Math.hypot(sample.ax, sample.ay, sample.az)
}

function gyroMagnitude(sample: Sample) {
  return Math.hypot(sample.gx, sample.gy, sample.gz)
}

type MotionSampleLabel = MotionLabel | 'none'

function classifySample(sample: Sample): MotionSampleLabel {
  const a = accelMagnitude(sample)
  const g = gyroMagnitude(sample)

  // Placeholder heuristics. Replace with a real model/pipeline later.
  if (a > 0.5 && g > 1.2) return 'running'
  if (g > 2.2 && a < 0.45) return 'swing'
  return 'none'
}

export function detectMotionRanges(points: Sample[]) {
  if (points.length < 3) return [] as MotionRange[]

  const labels = points.map(classifySample)
  const minDurationSec = 0.55
  const minSamples = 10

  const ranges: MotionRange[] = []
  let activeLabel: MotionSampleLabel = 'none'
  let start = -1

  const flush = (endIndex: number) => {
    if (activeLabel === 'none' || start < 0) return

    const durationSec = Math.max(0, points[endIndex].t - points[start].t)
    const sampleCount = endIndex - start + 1
    if (durationSec < minDurationSec || sampleCount < minSamples) return

    const confidence = Math.min(1, (sampleCount / 28 + durationSec / 2.4) / 2)

    ranges.push({
      label: activeLabel,
      startIndex: start,
      endIndex,
      durationSec,
      confidence,
    })
  }

  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i]

    if (activeLabel === 'none') {
      if (label !== 'none') {
        activeLabel = label
        start = i
      }
      continue
    }

    if (label === activeLabel) continue

    flush(i - 1)
    if (label === 'none') {
      activeLabel = 'none'
      start = -1
    } else {
      activeLabel = label
      start = i
    }
  }

  flush(labels.length - 1)
  return ranges
}
