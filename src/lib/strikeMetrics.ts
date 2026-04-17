import type { Sample } from './sensor'

const GRAVITY_MPS2 = 9.80665
const PRE_IMPACT_WINDOW_SEC = 0.15

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function smoothMagnitudes(values: number[]) {
  return values.map((_, index) => {
    const left = Math.max(0, index - 2)
    const right = Math.min(values.length - 1, index + 2)
    let sum = 0
    for (let sampleIndex = left; sampleIndex <= right; sampleIndex += 1) {
      sum += values[sampleIndex]
    }
    return sum / (right - left + 1)
  })
}

type SignalScan = {
  accMagnitudes: number[]
  gyroMagnitudes: number[]
  peakAccMagG: number
  peakAccLocalIndex: number
  peakGyroMagRadPerSec: number
  peakJerkGPerSec: number
  peakJerkLocalIndex: number
}

export type StrikeWindowMetrics = {
  strikeStartIndex: number
  impactIndex: number
  strikeEndIndex: number
  peakAccMagG: number
  peakGyroMagRadPerSec: number
  peakJerkGPerSec: number
  strikeDurationMs: number
  swingBeginTimeSec: number
  impactTimeSec: number
  swingDurationToImpactMs: number
  preImpactDurationMs: number
  postImpactDurationMs: number
  preImpactSpeedProxyMps: number
  sampleCount: number
}

function scanRangeSignals(rangePoints: Sample[]): SignalScan {
  const accMagnitudes: number[] = []
  const gyroMagnitudes: number[] = []

  let peakAccMagG = 0
  let peakAccLocalIndex = 0
  let peakGyroMagRadPerSec = 0
  let peakJerkGPerSec = 0
  let peakJerkLocalIndex = -1

  let prevSample: Sample | null = null

  for (let index = 0; index < rangePoints.length; index += 1) {
    const point = rangePoints[index]
    const accelMagnitudeG = Math.hypot(point.ax, point.ay, point.az)
    const gyroMagnitudeRadPerSec = Math.hypot(point.gx, point.gy, point.gz)

    accMagnitudes.push(accelMagnitudeG)
    gyroMagnitudes.push(gyroMagnitudeRadPerSec)

    if (accelMagnitudeG > peakAccMagG) {
      peakAccMagG = accelMagnitudeG
      peakAccLocalIndex = index
    }
    peakGyroMagRadPerSec = Math.max(peakGyroMagRadPerSec, gyroMagnitudeRadPerSec)

    if (prevSample) {
      const dt = point.timestamp - prevSample.timestamp
      if (Number.isFinite(dt) && dt > 0) {
        const jerkGPerSec = Math.hypot(point.ax - prevSample.ax, point.ay - prevSample.ay, point.az - prevSample.az) / dt
        if (jerkGPerSec > peakJerkGPerSec) {
          peakJerkGPerSec = jerkGPerSec
          peakJerkLocalIndex = index
        }
      }
    }

    prevSample = point
  }

  return {
    accMagnitudes,
    gyroMagnitudes,
    peakAccMagG,
    peakAccLocalIndex,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    peakJerkLocalIndex,
  }
}

function findImpactLocalIndex(accMagnitudes: number[], peakAccLocalIndex: number, peakJerkLocalIndex: number) {
  let impactLocalIndex = peakAccLocalIndex

  if (peakJerkLocalIndex > 0) {
    // Assume impact occurs before the largest acceleration-rate change (peak jerk).
    const maxImpactLocalIndex = peakJerkLocalIndex - 1
    let constrainedPeakAcc = Number.NEGATIVE_INFINITY

    for (let index = 0; index <= maxImpactLocalIndex; index += 1) {
      const accelMagnitudeG = accMagnitudes[index] ?? 0
      if (accelMagnitudeG > constrainedPeakAcc) {
        constrainedPeakAcc = accelMagnitudeG
        impactLocalIndex = index
      }
    }
  }

  return impactLocalIndex
}

function findSwingBeginLocalIndex(smoothedGyroMagnitudes: number[], impactLocalIndex: number) {
  const preImpactGyro = smoothedGyroMagnitudes.slice(0, impactLocalIndex + 1)
  const baselineCount = Math.max(1, Math.min(preImpactGyro.length, Math.max(3, Math.floor(preImpactGyro.length / 4))))
  const baselineGyro = average(preImpactGyro.slice(0, baselineCount))
  const preImpactPeakGyro = preImpactGyro.reduce((max, value) => Math.max(max, value), 0)
  const gyroRise = Math.max(0, preImpactPeakGyro - baselineGyro)
  const activationThreshold = baselineGyro + Math.max(gyroRise * 0.35, 0.8)
  const releaseThreshold = baselineGyro + Math.max(gyroRise * 0.18, 0.4)

  let swingBeginLocalIndex = 0
  let activationIndex = -1

  for (let index = impactLocalIndex; index >= 0; index -= 1) {
    if (smoothedGyroMagnitudes[index] >= activationThreshold) {
      activationIndex = index
      break
    }
  }

  if (activationIndex >= 0) {
    let localStartIndex = activationIndex
    while (localStartIndex > 0 && smoothedGyroMagnitudes[localStartIndex - 1] >= releaseThreshold) {
      localStartIndex -= 1
    }
    swingBeginLocalIndex = localStartIndex
  }

  return swingBeginLocalIndex
}

function findStrikeLocalBounds(
  smoothedAccMagnitudes: number[],
  smoothedGyroMagnitudes: number[],
  impactLocalIndex: number,
  peakAccMagG: number,
) {
  const rangeLength = smoothedAccMagnitudes.length
  const flankCount = Math.max(1, Math.min(Math.floor(rangeLength / 5), 8))
  const accBaseline = average([
    ...smoothedAccMagnitudes.slice(0, flankCount),
    ...smoothedAccMagnitudes.slice(Math.max(flankCount, rangeLength - flankCount)),
  ])
  const gyroBaseline = average([
    ...smoothedGyroMagnitudes.slice(0, flankCount),
    ...smoothedGyroMagnitudes.slice(Math.max(flankCount, rangeLength - flankCount)),
  ])
  const peakAccSmoothed = smoothedAccMagnitudes[impactLocalIndex] ?? peakAccMagG
  const peakGyroSmoothed = smoothedGyroMagnitudes.reduce((max, value) => Math.max(max, value), 0)
  const highAccThreshold = accBaseline + Math.max((peakAccSmoothed - accBaseline) * 0.55, 1.2)
  const supportAccThreshold = accBaseline + Math.max((peakAccSmoothed - accBaseline) * 0.28, 0.45)
  const supportGyroThreshold = gyroBaseline + Math.max((peakGyroSmoothed - gyroBaseline) * 0.3, 0.8)

  const isStrikeEventActive = (index: number) => {
    const acc = smoothedAccMagnitudes[index] ?? 0
    const gyro = smoothedGyroMagnitudes[index] ?? 0
    return acc >= highAccThreshold || (acc >= supportAccThreshold && gyro >= supportGyroThreshold)
  }

  let strikeStartLocalIndex = impactLocalIndex
  while (strikeStartLocalIndex > 0) {
    const prevIndex = strikeStartLocalIndex - 1
    if (!isStrikeEventActive(prevIndex)) break
    strikeStartLocalIndex = prevIndex
  }

  let strikeEndLocalIndex = impactLocalIndex
  while (strikeEndLocalIndex < rangeLength - 1) {
    const nextIndex = strikeEndLocalIndex + 1
    if (!isStrikeEventActive(nextIndex)) break
    strikeEndLocalIndex = nextIndex
  }

  return { strikeStartLocalIndex, strikeEndLocalIndex }
}

function computePreImpactSpeedProxy(
  points: Sample[],
  impactIndex: number,
  lowerBoundIndex: number,
  preImpactSpeedStartTimeSec: number,
) {
  let preImpactSpeedProxyMps = 0

  for (let index = impactIndex; index > lowerBoundIndex; index -= 1) {
    const current = points[index]
    const previous = points[index - 1]
    const dt = current.timestamp - previous.timestamp

    if (!Number.isFinite(dt) || dt <= 0) continue
    if (previous.t < preImpactSpeedStartTimeSec) break

    const accelMagnitudeMps2 =
      Math.hypot((current.ax + previous.ax) * 0.5, (current.ay + previous.ay) * 0.5, (current.az + previous.az) * 0.5) *
      GRAVITY_MPS2
    preImpactSpeedProxyMps += accelMagnitudeMps2 * dt
  }

  return preImpactSpeedProxyMps
}

export function computeStrikeWindowMetrics(points: Sample[], startIndex: number, endIndex: number): StrikeWindowMetrics | null {
  if (!points.length) return null

  const start = Math.max(0, Math.min(points.length - 1, Math.min(startIndex, endIndex)))
  const end = Math.max(start, Math.min(points.length - 1, Math.max(startIndex, endIndex)))
  const rangePoints = points.slice(start, end + 1)

  if (!rangePoints.length) return null

  const {
    accMagnitudes,
    gyroMagnitudes,
    peakAccMagG,
    peakAccLocalIndex,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    peakJerkLocalIndex,
  } = scanRangeSignals(rangePoints)
  const smoothedAccMagnitudes = smoothMagnitudes(accMagnitudes)
  const smoothedGyroMagnitudes = smoothMagnitudes(gyroMagnitudes)

  const impactLocalIndex = findImpactLocalIndex(accMagnitudes, peakAccLocalIndex, peakJerkLocalIndex)
  const swingBeginLocalIndex = findSwingBeginLocalIndex(smoothedGyroMagnitudes, impactLocalIndex)
  const { strikeStartLocalIndex, strikeEndLocalIndex } = findStrikeLocalBounds(
    smoothedAccMagnitudes,
    smoothedGyroMagnitudes,
    impactLocalIndex,
    peakAccMagG,
  )

  const swingBeginIndex = start + swingBeginLocalIndex
  const strikeStartIndex = start + strikeStartLocalIndex
  const impactIndex = start + impactLocalIndex
  const strikeEndIndex = start + strikeEndLocalIndex

  const swingBeginTimeSec = points[swingBeginIndex]?.t ?? rangePoints[0].t
  const impactTimeSec = points[impactIndex]?.t ?? rangePoints[0].t
  const strikeStartTimeSec = rangePoints[strikeStartLocalIndex]?.t ?? impactTimeSec
  const strikeEndTimeSec = rangePoints[strikeEndLocalIndex]?.t ?? impactTimeSec

  const strikeDurationMs = Math.max(0, (strikeEndTimeSec - strikeStartTimeSec) * 1000)
  const swingDurationToImpactMs = Math.max(0, (impactTimeSec - swingBeginTimeSec) * 1000)
  const preImpactDurationMs = Math.max(0, (impactTimeSec - strikeStartTimeSec) * 1000)
  const postImpactDurationMs = Math.max(0, (strikeEndTimeSec - impactTimeSec) * 1000)

  const preImpactSpeedStartTimeSec = Math.max(swingBeginTimeSec, impactTimeSec - PRE_IMPACT_WINDOW_SEC)
  const preImpactSpeedProxyMps = computePreImpactSpeedProxy(
    points,
    impactIndex,
    Math.max(swingBeginIndex, strikeStartIndex),
    preImpactSpeedStartTimeSec,
  )

  return {
    strikeStartIndex,
    impactIndex,
    strikeEndIndex,
    peakAccMagG,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    strikeDurationMs,
    swingBeginTimeSec,
    impactTimeSec,
    swingDurationToImpactMs,
    preImpactDurationMs,
    postImpactDurationMs,
    preImpactSpeedProxyMps,
    sampleCount: rangePoints.length,
  }
}
