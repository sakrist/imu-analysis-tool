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
  jerkMagnitudes: number[]
  peakAccMagG: number
  peakAccLocalIndex: number
  peakGyroMagRadPerSec: number
  peakJerkGPerSec: number
  peakJerkLocalIndex: number
}

export type StrikeWindowMetrics = {
  swingBeginIndex: number
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
  const jerkMagnitudes: number[] = []

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
    jerkMagnitudes.push(0)

    if (accelMagnitudeG > peakAccMagG) {
      peakAccMagG = accelMagnitudeG
      peakAccLocalIndex = index
    }
    peakGyroMagRadPerSec = Math.max(peakGyroMagRadPerSec, gyroMagnitudeRadPerSec)

    if (prevSample) {
      const dt = point.timestamp - prevSample.timestamp
      if (Number.isFinite(dt) && dt > 0) {
        const jerkGPerSec = Math.hypot(point.ax - prevSample.ax, point.ay - prevSample.ay, point.az - prevSample.az) / dt
        jerkMagnitudes[index] = jerkGPerSec
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
    jerkMagnitudes,
    peakAccMagG,
    peakAccLocalIndex,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    peakJerkLocalIndex,
  }
}

function findImpactLocalIndex(jerkMagnitudes: number[], peakAccLocalIndex: number, peakJerkLocalIndex: number) {
  let impactLocalIndex = peakAccLocalIndex

  if (peakJerkLocalIndex > 0) {
    // Treat impact as the onset of the main acceleration-change burst, not the largest acceleration sample after it.
    const jerkBeforePeak = jerkMagnitudes.slice(0, peakJerkLocalIndex + 1)
    const baselineCount = Math.max(1, Math.min(jerkBeforePeak.length, Math.max(3, Math.floor(jerkBeforePeak.length / 4))))
    const baselineJerk = average(jerkBeforePeak.slice(0, baselineCount))
    const peakJerk = jerkMagnitudes[peakJerkLocalIndex] ?? 0
    const jerkRise = Math.max(0, peakJerk - baselineJerk)

    if (jerkRise > 0) {
      const activationThreshold = baselineJerk + jerkRise * 0.45
      const releaseThreshold = baselineJerk + jerkRise * 0.2

      let clusterStartIndex = peakJerkLocalIndex
      while (clusterStartIndex > 0 && (jerkMagnitudes[clusterStartIndex - 1] ?? 0) >= releaseThreshold) {
        clusterStartIndex -= 1
      }

      impactLocalIndex = clusterStartIndex
      for (let index = clusterStartIndex; index <= peakJerkLocalIndex; index += 1) {
        if ((jerkMagnitudes[index] ?? 0) >= activationThreshold) {
          impactLocalIndex = index
          break
        }
      }
    }
  }

  return impactLocalIndex
}

function findSwingBeginLocalIndex(
  smoothedAccMagnitudes: number[],
  smoothedGyroMagnitudes: number[],
  strikeStartLocalIndex: number,
  impactLocalIndex: number,
) {
  const searchStart = Math.max(0, Math.min(strikeStartLocalIndex, impactLocalIndex))
  const searchEnd = Math.max(searchStart, impactLocalIndex)
  if (searchEnd <= searchStart) return searchStart

  const preImpactAcc = smoothedAccMagnitudes.slice(searchStart, searchEnd + 1)
  const preImpactGyro = smoothedGyroMagnitudes.slice(searchStart, searchEnd + 1)
  const baselineCount = Math.max(1, Math.min(preImpactAcc.length, Math.max(3, Math.floor(preImpactAcc.length / 3))))
  const baselineAcc = average(preImpactAcc.slice(0, baselineCount))
  const baselineGyro = average(preImpactGyro.slice(0, baselineCount))
  const peakPreImpactAcc = preImpactAcc.reduce((max, value) => Math.max(max, value), 0)
  const peakPreImpactGyro = preImpactGyro.reduce((max, value) => Math.max(max, value), 0)
  const accRise = Math.max(0, peakPreImpactAcc - baselineAcc)
  const gyroRise = Math.max(0, peakPreImpactGyro - baselineGyro)

  if (accRise <= 1e-6 && gyroRise <= 1e-6) return searchStart

  const accActivationThreshold = baselineAcc + Math.max(accRise * 0.16, 0.08)
  const gyroActivationThreshold = baselineGyro + Math.max(gyroRise * 0.16, 0.35)
  const accGrowthThreshold = Math.max(accRise * 0.07, 0.03)
  const gyroGrowthThreshold = Math.max(gyroRise * 0.07, 0.08)

  // Anchor the start when the pre-impact build-up first becomes sustained,
  // rather than at the whole-window start or the later jerk burst.
  for (let index = searchStart + 1; index <= searchEnd; index += 1) {
    const acc = smoothedAccMagnitudes[index] ?? baselineAcc
    const prevAcc = smoothedAccMagnitudes[index - 1] ?? acc
    const gyro = smoothedGyroMagnitudes[index] ?? baselineGyro
    const prevGyro = smoothedGyroMagnitudes[index - 1] ?? gyro
    const lookaheadEnd = Math.min(searchEnd, index + 2)
    const nextAccAverage = average(smoothedAccMagnitudes.slice(index, lookaheadEnd + 1))
    const nextGyroAverage = average(smoothedGyroMagnitudes.slice(index, lookaheadEnd + 1))
    const accActive = acc >= accActivationThreshold || nextAccAverage >= accActivationThreshold
    const gyroActive = gyro >= gyroActivationThreshold || nextGyroAverage >= gyroActivationThreshold
    const accGrowing = acc - prevAcc >= accGrowthThreshold || nextAccAverage - baselineAcc >= accGrowthThreshold
    const gyroGrowing = gyro - prevGyro >= gyroGrowthThreshold || nextGyroAverage - baselineGyro >= gyroGrowthThreshold

    if ((accActive || gyroActive) && (accGrowing || gyroGrowing)) {
      return index
    }
  }

  return searchStart
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
    jerkMagnitudes,
    peakAccMagG,
    peakAccLocalIndex,
    peakGyroMagRadPerSec,
    peakJerkGPerSec,
    peakJerkLocalIndex,
  } = scanRangeSignals(rangePoints)
  const smoothedAccMagnitudes = smoothMagnitudes(accMagnitudes)
  const smoothedGyroMagnitudes = smoothMagnitudes(gyroMagnitudes)
  const smoothedJerkMagnitudes = smoothMagnitudes(jerkMagnitudes)

  const impactLocalIndex = findImpactLocalIndex(smoothedJerkMagnitudes, peakAccLocalIndex, peakJerkLocalIndex)
  const { strikeStartLocalIndex, strikeEndLocalIndex } = findStrikeLocalBounds(
    smoothedAccMagnitudes,
    smoothedGyroMagnitudes,
    impactLocalIndex,
    peakAccMagG,
  )
  const swingBeginLocalIndex = findSwingBeginLocalIndex(
    smoothedAccMagnitudes,
    smoothedGyroMagnitudes,
    strikeStartLocalIndex,
    impactLocalIndex,
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
    swingBeginIndex,
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
