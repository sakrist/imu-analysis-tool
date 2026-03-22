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
  preImpactDurationMs: number
  postImpactDurationMs: number
  preImpactSpeedProxyMps: number
  sampleCount: number
}

export function computeStrikeWindowMetrics(points: Sample[], startIndex: number, endIndex: number): StrikeWindowMetrics | null {
  if (!points.length) return null

  const start = Math.max(0, Math.min(points.length - 1, Math.min(startIndex, endIndex)))
  const end = Math.max(start, Math.min(points.length - 1, Math.max(startIndex, endIndex)))
  const rangePoints = points.slice(start, end + 1)

  if (!rangePoints.length) return null

  let peakAccMagG = 0
  let peakGyroMagRadPerSec = 0
  let peakJerkGPerSec = 0
  let impactIndex = start

  let prevSample: Sample | null = null

  for (let index = 0; index < rangePoints.length; index += 1) {
    const point = rangePoints[index]
    const accelMagnitudeG = Math.hypot(point.ax, point.ay, point.az)
    const gyroMagnitudeRadPerSec = Math.hypot(point.gx, point.gy, point.gz)

    if (accelMagnitudeG > peakAccMagG) {
      peakAccMagG = accelMagnitudeG
      impactIndex = start + index
    }
    peakGyroMagRadPerSec = Math.max(peakGyroMagRadPerSec, gyroMagnitudeRadPerSec)

    if (prevSample) {
      const dt = point.timestamp - prevSample.timestamp
      if (Number.isFinite(dt) && dt > 0) {
        const jerkGPerSec = Math.hypot(point.ax - prevSample.ax, point.ay - prevSample.ay, point.az - prevSample.az) / dt
        peakJerkGPerSec = Math.max(peakJerkGPerSec, jerkGPerSec)
      }
    }

    prevSample = point
  }

  const impactPoint = points[impactIndex]
  const impactTimeSec = impactPoint?.t ?? rangePoints[0].t
  const impactLocalIndex = impactIndex - start

  const accMagnitudes = rangePoints.map((point) => Math.hypot(point.ax, point.ay, point.az))
  const gyroMagnitudes = rangePoints.map((point) => Math.hypot(point.gx, point.gy, point.gz))
  const smoothedAccMagnitudes = smoothMagnitudes(accMagnitudes)
  const smoothedGyroMagnitudes = smoothMagnitudes(gyroMagnitudes)

  const preImpactGyro = smoothedGyroMagnitudes.slice(0, impactLocalIndex + 1)
  const baselineCount = Math.max(1, Math.min(preImpactGyro.length, Math.max(3, Math.floor(preImpactGyro.length / 4))))
  const baselineGyro =
    average(preImpactGyro.slice(0, baselineCount))
  const preImpactPeakGyro = preImpactGyro.reduce((max, value) => Math.max(max, value), 0)
  const gyroRise = Math.max(0, preImpactPeakGyro - baselineGyro)
  const activationThreshold = baselineGyro + Math.max(gyroRise * 0.35, 0.8)
  const releaseThreshold = baselineGyro + Math.max(gyroRise * 0.18, 0.4)

  let swingBeginIndex = start
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
    swingBeginIndex = start + localStartIndex
  }

  const swingBeginTimeSec = points[swingBeginIndex]?.t ?? rangePoints[0].t

  const flankCount = Math.max(1, Math.min(Math.floor(rangePoints.length / 5), 8))
  const accBaseline = average([
    ...smoothedAccMagnitudes.slice(0, flankCount),
    ...smoothedAccMagnitudes.slice(Math.max(flankCount, smoothedAccMagnitudes.length - flankCount)),
  ])
  const gyroBaseline = average([
    ...smoothedGyroMagnitudes.slice(0, flankCount),
    ...smoothedGyroMagnitudes.slice(Math.max(flankCount, smoothedGyroMagnitudes.length - flankCount)),
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
  while (strikeEndLocalIndex < rangePoints.length - 1) {
    const nextIndex = strikeEndLocalIndex + 1
    if (!isStrikeEventActive(nextIndex)) break
    strikeEndLocalIndex = nextIndex
  }

  const strikeStartTimeSec = rangePoints[strikeStartLocalIndex]?.t ?? impactTimeSec
  const strikeEndTimeSec = rangePoints[strikeEndLocalIndex]?.t ?? impactTimeSec
  const strikeDurationMs = Math.max(0, (strikeEndTimeSec - strikeStartTimeSec) * 1000)
  const preImpactDurationMs = Math.max(0, (impactTimeSec - strikeStartTimeSec) * 1000)
  const postImpactDurationMs = Math.max(0, (strikeEndTimeSec - impactTimeSec) * 1000)
  const preImpactSpeedStartTimeSec = Math.max(swingBeginTimeSec, impactTimeSec - PRE_IMPACT_WINDOW_SEC)

  let preImpactSpeedProxyMps = 0
  for (let index = impactIndex; index > Math.max(swingBeginIndex, start + strikeStartLocalIndex); index -= 1) {
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

  return {
    strikeStartIndex: start + strikeStartLocalIndex,
    impactIndex,
    strikeEndIndex: start + strikeEndLocalIndex,
    peakAccMagG,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    strikeDurationMs,
    swingBeginTimeSec,
    impactTimeSec,
    preImpactDurationMs,
    postImpactDurationMs,
    preImpactSpeedProxyMps,
    sampleCount: rangePoints.length,
  }
}
