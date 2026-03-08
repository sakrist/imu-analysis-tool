import * as THREE from 'three'

export type AxisKey = 'ax' | 'ay' | 'az' | 'gx' | 'gy' | 'gz' | 'grx' | 'gry' | 'grz'

export type Sample = {
  timestamp: number
  t: number
  ax: number
  ay: number
  az: number
  gx: number
  gy: number
  gz: number
  grx: number
  gry: number
  grz: number
}

export const CHART_GROUPS: Array<{ title: string; keys: AxisKey[] }> = [
  { title: 'Acceleration', keys: ['ax', 'ay', 'az'] },
  { title: 'Gyroscope', keys: ['gx', 'gy', 'gz'] },
  { title: 'Gravity', keys: ['grx', 'gry', 'grz'] },
]

export const COLORS: Record<AxisKey, string> = {
  ax: '#f97316',
  ay: '#f59e0b',
  az: '#facc15',
  gx: '#22c55e',
  gy: '#06b6d4',
  gz: '#3b82f6',
  grx: '#a855f7',
  gry: '#ec4899',
  grz: '#ef4444',
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '-'
}

export function parseCsv(text: string): Sample[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const required = ['timestamp', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'grx', 'gry', 'grz']

  if (!required.every((field) => header.includes(field))) {
    throw new Error('CSV columns must include: timestamp, ax, ay, az, gx, gy, gz, grx, gry, grz')
  }

  const indexOf = (name: string) => header.indexOf(name)
  const baseTimestamp = Number(lines[1].split(',')[indexOf('timestamp')])

  return lines
    .slice(1)
    .map((line): Sample | null => {
      const parts = line.split(',')
      if (parts.length < required.length) return null

      const timestamp = Number(parts[indexOf('timestamp')])
      const ax = Number(parts[indexOf('ax')])
      const ay = Number(parts[indexOf('ay')])
      const az = Number(parts[indexOf('az')])
      const gx = Number(parts[indexOf('gx')])
      const gy = Number(parts[indexOf('gy')])
      const gz = Number(parts[indexOf('gz')])
      const grx = Number(parts[indexOf('grx')])
      const gry = Number(parts[indexOf('gry')])
      const grz = Number(parts[indexOf('grz')])

      const values = [timestamp, ax, ay, az, gx, gy, gz, grx, gry, grz]
      if (values.some((value) => Number.isNaN(value))) return null

      return {
        timestamp,
        t: timestamp - baseTimestamp,
        ax,
        ay,
        az,
        gx,
        gy,
        gz,
        grx,
        gry,
        grz,
      }
    })
    .filter((point): point is Sample => point !== null)
}

export function sampleVisible(points: Sample[], key: AxisKey, from: number, to: number, width: number) {
  const count = to - from + 1
  if (count <= 0 || width <= 0) return [] as Array<{ i: number; v: number }>

  const maxPoints = Math.max(200, width * 2)
  const step = Math.max(1, Math.ceil(count / maxPoints))
  const sampled: Array<{ i: number; v: number }> = []

  for (let i = from; i <= to; i += step) {
    sampled.push({ i, v: points[i][key] })
  }
  if (sampled[sampled.length - 1]?.i !== to) {
    sampled.push({ i: to, v: points[to][key] })
  }

  return sampled
}

export function toPath(
  sampled: Array<{ i: number; v: number }>,
  from: number,
  to: number,
  yMin: number,
  yMax: number,
  width: number,
  height: number,
) {
  if (!sampled.length) return ''

  const range = Math.max(1e-9, to - from)
  const yRange = Math.max(1e-9, yMax - yMin)

  let path = ''
  for (let k = 0; k < sampled.length; k += 1) {
    const p = sampled[k]
    const x = ((p.i - from) / range) * width
    const y = height - ((p.v - yMin) / yRange) * height
    path += `${k === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }
  return path
}

export function computeTrajectory(points: Sample[], start: number, end: number) {
  if (!points.length || end < start) return [] as THREE.Vector3[]

  const clampedStart = clamp(start, 0, points.length - 1)
  const clampedEnd = clamp(end, clampedStart, points.length - 1)

  const position = new THREE.Vector3(0, 0, 0)
  const velocity = new THREE.Vector3(0, 0, 0)
  const orientation = new THREE.Quaternion()
  const deviceGravity = new THREE.Vector3(
    points[clampedStart].grx,
    points[clampedStart].gry,
    points[clampedStart].grz,
  )

  if (deviceGravity.lengthSq() > 1e-6) {
    const worldDown = new THREE.Vector3(0, -1, 0)
    orientation.setFromUnitVectors(deviceGravity.clone().normalize(), worldDown)
  }

  const positions: THREE.Vector3[] = []
  const gyro = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const accel = new THREE.Vector3()
  const gravity = new THREE.Vector3()
  const linearWorld = new THREE.Vector3()
  const deltaQ = new THREE.Quaternion()

  positions.push(position.clone())

  for (let i = clampedStart + 1; i <= clampedEnd; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    const dt = clamp(next.timestamp - prev.timestamp, 0, 0.1)
    if (dt <= 0) {
      positions.push(position.clone())
      continue
    }

    gyro.set(next.gx, next.gy, next.gz)
    const angularSpeed = gyro.length()
    if (angularSpeed > 1e-6) {
      axis.copy(gyro).multiplyScalar(1 / angularSpeed)
      deltaQ.setFromAxisAngle(axis, angularSpeed * dt)
      orientation.multiply(deltaQ).normalize()
    }

    accel.set(next.ax, next.ay, next.az)
    gravity.set(next.grx, next.gry, next.grz)

    linearWorld
      .copy(accel)
      .sub(gravity)
      .multiplyScalar(9.81)
      .applyQuaternion(orientation)

    velocity.addScaledVector(linearWorld, dt)
    velocity.multiplyScalar(Math.exp(-dt * 1.8))
    position.addScaledVector(velocity, dt)
    positions.push(position.clone())
  }

  return positions
}
