import type { LabeledRange } from './labels'
import type { Sample } from './sensor'

export type StrikeWindowPrediction = {
  windowStart: number
  windowEnd: number
  centerIndex: number
  centerTimeSec: number
  probability: number
}

export type StrikeInferenceResult = {
  modelVersion: string
  label: string
  labelMode: string
  labelEndPadding: number
  windowSize: number
  stride: number
  defaultThreshold: number
  windowPredictions: StrikeWindowPrediction[]
}

export type PredictedStrikeRange = LabeledRange & {
  maxProbability: number
  meanProbability: number
  windowCount: number
}

const STRIKE_API_BASE_URL = ((import.meta.env.VITE_STRIKE_API_URL as string | undefined) ?? '/api/strike').replace(
  /\/$/,
  '',
)

let serviceAvailabilityPromise: Promise<boolean> | null = null

async function hasStrikeModelService() {
  if (!serviceAvailabilityPromise) {
    serviceAvailabilityPromise = fetch(`${STRIKE_API_BASE_URL}/health`)
      .then((response) => response.ok)
      .catch(() => false)
  }

  return serviceAvailabilityPromise
}

export async function hasStrikeModelArtifact() {
  return hasStrikeModelService()
}

async function inferStrikeWindowsViaService(points: Sample[]): Promise<StrikeInferenceResult> {
  const response = await fetch(`${STRIKE_API_BASE_URL}/infer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      points: points.map((point) => ({
        timestamp: point.timestamp,
        ax: point.ax,
        ay: point.ay,
        az: point.az,
        gx: point.gx,
        gy: point.gy,
        gz: point.gz,
        grx: point.grx,
        gry: point.gry,
        grz: point.grz,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(`FastAPI strike inference failed with status ${response.status}`)
  }

  return (await response.json()) as StrikeInferenceResult
}

export async function inferStrikeWindows(points: Sample[]): Promise<StrikeInferenceResult> {
  if (!(await hasStrikeModelService())) {
    throw new Error('FastAPI strike inference service is unavailable')
  }

  return inferStrikeWindowsViaService(points)
}

export function buildPredictedStrikeRanges(
  points: Sample[],
  predictions: StrikeWindowPrediction[],
  threshold: number,
  stride: number,
  label = 'strike (model)',
): PredictedStrikeRange[] {
  if (!points.length || !predictions.length) return []

  const clampedThreshold = Math.min(1, Math.max(0, threshold))
  const positivePredictions = predictions.filter((prediction) => prediction.probability >= clampedThreshold)
  if (!positivePredictions.length) return []

  const effectiveStride = Math.max(1, stride)
  const rangePadding = Math.max(1, Math.floor(effectiveStride / 2))

  const ranges: PredictedStrikeRange[] = []
  let groupStart = 0

  const flushGroup = (groupEnd: number) => {
    const group = positivePredictions.slice(groupStart, groupEnd + 1)
    const startIndex = Math.max(0, group[0].centerIndex - rangePadding)
    const endIndex = Math.min(points.length - 1, group[group.length - 1].centerIndex + rangePadding)
    const probabilities = group.map((prediction) => prediction.probability)
    const maxProbability = Math.max(...probabilities)
    const meanProbability = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length

    ranges.push({
      id: `predicted-${startIndex}-${endIndex}-${group.length}`,
      label,
      startIndex,
      endIndex,
      startTimeSec: points[startIndex]?.t ?? 0,
      endTimeSec: points[endIndex]?.t ?? 0,
      durationSec: Math.max(0, (points[endIndex]?.t ?? 0) - (points[startIndex]?.t ?? 0)),
      sampleCount: endIndex - startIndex + 1,
      maxProbability,
      meanProbability,
      windowCount: group.length,
    })
  }

  for (let index = 1; index < positivePredictions.length; index += 1) {
    const prev = positivePredictions[index - 1]
    const current = positivePredictions[index]

    if (current.centerIndex - prev.centerIndex <= effectiveStride) continue

    flushGroup(index - 1)
    groupStart = index
  }

  flushGroup(positivePredictions.length - 1)
  return ranges
}
