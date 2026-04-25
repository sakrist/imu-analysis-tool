import { fmt, type Sample } from './sensor'
import { computeStrikeWindowMetrics, type StrikeWindowMetrics } from './strikeMetrics'
import { type PredictedStrikeRange } from './strikeModel'

export const MIN_AIR_STRIKE_PEAK_JERK_G_PER_SEC = 500
export const MIN_SWING_DURATION_TO_IMPACT_MS = 20
export const MIN_PRE_IMPACT_HURLEY_HANDLE_SPEED_MPS = 1

export const STRIKE_METRIC_INFO = {
  peakSwingSpeed:
    'Peak rotational speed during the selected swing. Higher values usually mean the hurley was moving faster through the strike. The comparison text shows how this strike sits against the session median.',
  preImpactSpeedIndex:
    'Estimated pre-impact hurley handle speed. It is derived from the acceleration build-up leading into impact and is useful for comparing swings, but it is not yet a true calibrated tip-speed measurement.',
  impactSharpness:
    'How abruptly acceleration changes at impact. Higher values usually indicate a crisper, sharper strike.',
  swingDurationToImpact:
    'Time from the detected swing start to impact. This helps track swing timing and tempo.',
  consistencyScore:
    'How closely this strike matches the session median across swing speed, pre-impact hurley handle speed, impact sharpness, and timing. It becomes more meaningful once you have multiple strikes in the session.',
} satisfies Record<string, string>

export type StrikeMetricInfoKey = keyof typeof STRIKE_METRIC_INFO

export type PredictedRangeMetricSummary = {
  rangeId: string
  peakSwingSpeed: number
  preImpactSpeedIndex: number
  impactSharpness: number
  swingDurationToImpact: number
}

export type SelectedPredictedMetricItem = {
  id: StrikeMetricInfoKey
  label: string
  value: string
  unit: string
  detail: string | null
}

type MetricRange = {
  id: string
  startIndex: number
  endIndex: number
}

function median(values: number[]) {
  if (!values.length) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) * 0.5 : sorted[mid]
}

function toConsistencyScore(value: number, baseline: number) {
  const scale = Math.max(Math.abs(baseline), 1e-6)
  return Math.abs(value - baseline) / scale
}

export function filterPredictedRanges(points: Sample[], modelPredictedRanges: PredictedStrikeRange[]) {
  const predictedRanges = modelPredictedRanges.filter((range) => {
    const metrics = computeStrikeWindowMetrics(points, range.startIndex, range.endIndex)
    return Boolean(
      metrics &&
        metrics.peakJerkGPerSec > MIN_AIR_STRIKE_PEAK_JERK_G_PER_SEC &&
        metrics.swingDurationToImpactMs > MIN_SWING_DURATION_TO_IMPACT_MS &&
        metrics.preImpactSpeedProxyMps > MIN_PRE_IMPACT_HURLEY_HANDLE_SPEED_MPS,
    )
  })

  return {
    predictedRanges,
    filteredPredictedRangeCount: Math.max(0, modelPredictedRanges.length - predictedRanges.length),
  }
}

export function buildPredictedRangeMetrics<T extends MetricRange>(points: Sample[], predictedRanges: T[]) {
  return predictedRanges
    .map((range) => {
      const metrics = computeStrikeWindowMetrics(points, range.startIndex, range.endIndex)
      if (!metrics) return null

      return {
        rangeId: range.id,
        peakSwingSpeed: metrics.peakGyroMagRadPerSec,
        preImpactSpeedIndex: metrics.preImpactSpeedProxyMps,
        impactSharpness: metrics.peakJerkGPerSec,
        swingDurationToImpact: metrics.swingDurationToImpactMs,
      }
    })
    .filter((item): item is PredictedRangeMetricSummary => item !== null)
}

export function getSelectedPredictedConsistencyScore(
  predictedRangeMetrics: PredictedRangeMetricSummary[],
  selectedPredictedRangeId: string | null,
) {
  if (!selectedPredictedRangeId) return null

  const selectedMetrics = predictedRangeMetrics.find((item) => item.rangeId === selectedPredictedRangeId)
  if (!selectedMetrics || predictedRangeMetrics.length < 2) return null

  const peakSwingSpeedMedian = median(predictedRangeMetrics.map((item) => item.peakSwingSpeed))
  const preImpactSpeedIndexMedian = median(predictedRangeMetrics.map((item) => item.preImpactSpeedIndex))
  const impactSharpnessMedian = median(predictedRangeMetrics.map((item) => item.impactSharpness))
  const swingDurationMedian = median(predictedRangeMetrics.map((item) => item.swingDurationToImpact))

  const meanDeviation =
    (
      toConsistencyScore(selectedMetrics.peakSwingSpeed, peakSwingSpeedMedian) +
      toConsistencyScore(selectedMetrics.preImpactSpeedIndex, preImpactSpeedIndexMedian) +
      toConsistencyScore(selectedMetrics.impactSharpness, impactSharpnessMedian) +
      toConsistencyScore(selectedMetrics.swingDurationToImpact, swingDurationMedian)
    ) /
    4

  return Math.min(100, Math.max(0, 100 * (1 - meanDeviation / 0.5)))
}

export function getSelectedPeakSwingSpeedComparison(
  predictedRangeMetrics: PredictedRangeMetricSummary[],
  selectedPredictedRangeId: string | null,
) {
  if (!selectedPredictedRangeId) return null

  const selectedMetrics = predictedRangeMetrics.find((item) => item.rangeId === selectedPredictedRangeId)
  if (!selectedMetrics || predictedRangeMetrics.length < 2) return null

  const peakSwingSpeedMedian = median(predictedRangeMetrics.map((item) => item.peakSwingSpeed))
  if (!Number.isFinite(peakSwingSpeedMedian) || Math.abs(peakSwingSpeedMedian) < 1e-6) return null

  const deltaPercent = ((selectedMetrics.peakSwingSpeed - peakSwingSpeedMedian) / peakSwingSpeedMedian) * 100
  if (Math.abs(deltaPercent) < 2) return 'About session median'

  return `${Math.abs(deltaPercent).toFixed(0)}% ${deltaPercent >= 0 ? 'above' : 'below'} session median`
}

export function buildSelectedPredictedMetricItems(
  selectedPredictedRangeMetrics: StrikeWindowMetrics | null,
  selectedPeakSwingSpeedComparison: string | null,
  selectedPredictedConsistencyScore: number | null,
  consistencyMissingDetail = 'Need at least 2 ranges for comparison',
): SelectedPredictedMetricItem[] {
  if (!selectedPredictedRangeMetrics) return []

  return [
    {
      id: 'peakSwingSpeed',
      label: 'Peak Swing Speed',
      value: fmt(selectedPredictedRangeMetrics.peakGyroMagRadPerSec),
      unit: 'rad/s',
      detail: selectedPeakSwingSpeedComparison,
    },
    {
      id: 'preImpactSpeedIndex',
      label: 'Pre-Impact Hurley Handle Speed',
      value: fmt(selectedPredictedRangeMetrics.preImpactSpeedProxyMps),
      unit: 'm/s',
      detail: null,
    },
    {
      id: 'impactSharpness',
      label: 'Impact Sharpness',
      value: fmt(selectedPredictedRangeMetrics.peakJerkGPerSec),
      unit: 'g/s',
      detail: null,
    },
    {
      id: 'swingDurationToImpact',
      label: 'Swing Duration to Impact',
      value: selectedPredictedRangeMetrics.swingDurationToImpactMs.toFixed(1),
      unit: 'ms',
      detail: null,
    },
    {
      id: 'consistencyScore',
      label: 'Consistency Score',
      value: selectedPredictedConsistencyScore === null ? '-' : selectedPredictedConsistencyScore.toFixed(0),
      unit: selectedPredictedConsistencyScore === null ? '' : '%',
      detail: selectedPredictedConsistencyScore === null ? consistencyMissingDetail : null,
    },
  ]
}
