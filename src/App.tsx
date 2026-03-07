import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './App.css'

type AxisKey = 'ax' | 'ay' | 'az' | 'gx' | 'gy' | 'gz' | 'grx' | 'gry' | 'grz'

type Sample = {
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

const CHART_GROUPS: Array<{ title: string; keys: AxisKey[] }> = [
  { title: 'Acceleration', keys: ['ax', 'ay', 'az'] },
  { title: 'Gyroscope', keys: ['gx', 'gy', 'gz'] },
  { title: 'Gravity', keys: ['grx', 'gry', 'grz'] },
]

const COLORS: Record<AxisKey, string> = {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parseCsv(text: string): Sample[] {
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

function sampleVisible(points: Sample[], key: AxisKey, from: number, to: number, width: number) {
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

function toPath(
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

function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '-'
}

function computeTrajectory(points: Sample[], start: number, end: number) {
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

  // Bootstrap orientation from gravity (yaw still drifts without magnetometer).
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

function App() {
  const [points, setPoints] = useState<Sample[]>([])
  const [error, setError] = useState<string>('')
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [chartWidth, setChartWidth] = useState(1000)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackSource, setPlaybackSource] = useState<'view' | 'selection'>('view')

  const chartRef = useRef<HTMLDivElement | null>(null)
  const motionViewRef = useRef<HTMLDivElement | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)
  const trailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const ghostTrailGeometryRef = useRef<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    const el = chartRef.current
    if (!el) return

    const resizeObserver = new ResizeObserver(() => {
      setChartWidth(Math.max(320, el.clientWidth - 24))
    })
    resizeObserver.observe(el)
    setChartWidth(Math.max(320, el.clientWidth - 24))

    return () => resizeObserver.disconnect()
  }, [])

  const viewSize = Math.max(1, viewEnd - viewStart)

  const playbackWindow = useMemo(() => {
    if (!points.length) return null
    if (playbackSource === 'selection' && selection) {
      return {
        start: Math.min(selection.start, selection.end),
        end: Math.max(selection.start, selection.end),
      }
    }
    return { start: viewStart, end: viewEnd }
  }, [playbackSource, points.length, selection, viewEnd, viewStart])

  const currentPoint = points[clamp(playbackIndex, 0, points.length - 1)]
  const trajectory = useMemo(() => {
    if (!playbackWindow) return []
    return computeTrajectory(points, playbackWindow.start, playbackWindow.end)
  }, [playbackWindow, points])
  const currentTrajectoryPoint = useMemo(() => {
    if (!playbackWindow || !trajectory.length) return null
    const idx = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    return trajectory[idx]
  }, [playbackIndex, playbackWindow, trajectory])

  useEffect(() => {
    if (!playbackWindow || !points.length || !playing) return

    const timer = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev < playbackWindow.start || prev > playbackWindow.end) return playbackWindow.start
        const next = prev + 1
        if (next > playbackWindow.end) {
          setPlaying(false)
          return playbackWindow.end
        }
        return next
      })
    }, 33)

    return () => clearInterval(timer)
  }, [playbackWindow, playing, points.length])

  useEffect(() => {
    const container = motionViewRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#fffaf1')

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(3.2, 2.6, 3.8)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)
    controls.update()

    const ambient = new THREE.AmbientLight(0xffffff, 0.75)
    const directional = new THREE.DirectionalLight(0xffffff, 0.8)
    directional.position.set(3, 5, 2)
    scene.add(ambient, directional)

    const grid = new THREE.GridHelper(4, 10, 0xd1c4ae, 0xe6ddcf)
    scene.add(grid)

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2))
    const box = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xbaa98f,
        transparent: true,
        opacity: 0.9,
      }),
    )
    scene.add(box)

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0xe76f51,
        roughness: 0.35,
        metalness: 0.1,
      }),
    )
    scene.add(sphere)
    sphereRef.current = sphere

    const ghostTrailGeometry = new THREE.BufferGeometry()
    ghostTrailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const ghostTrail = new THREE.Line(
      ghostTrailGeometry,
      new THREE.LineBasicMaterial({
        color: 0x8b7e6a,
        transparent: true,
        opacity: 0.35,
      }),
    )
    scene.add(ghostTrail)
    ghostTrailGeometryRef.current = ghostTrailGeometry

    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: 0xdc2626,
      }),
    )
    scene.add(trail)
    trailGeometryRef.current = trailGeometry

    let rafId = 0
    const resize = () => {
      const width = Math.max(220, container.clientWidth)
      const height = Math.max(240, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop)
      controls.update()
      renderer.render(scene, camera)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    renderLoop()

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      sphereRef.current = null
      trailGeometryRef.current = null
      ghostTrailGeometryRef.current = null
      scene.remove(sphere, trail, ghostTrail, box, grid, ambient, directional)
      ;(sphere.geometry as THREE.BufferGeometry).dispose()
      ;(sphere.material as THREE.Material).dispose()
      trailGeometry.dispose()
      ;(trail.material as THREE.Material).dispose()
      ghostTrailGeometry.dispose()
      ;(ghostTrail.material as THREE.Material).dispose()
      edges.dispose()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [points.length])

  useEffect(() => {
    if (!trajectory.length) return
    const flat = new Float32Array(trajectory.length * 3)
    trajectory.forEach((p, i) => {
      flat[i * 3] = p.x
      flat[i * 3 + 1] = p.y
      flat[i * 3 + 2] = p.z
    })

    if (ghostTrailGeometryRef.current) {
      ghostTrailGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(flat, 3))
      ghostTrailGeometryRef.current.setDrawRange(0, trajectory.length)
      ghostTrailGeometryRef.current.computeBoundingSphere()
    }

    if (trailGeometryRef.current) {
      trailGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(flat.slice(), 3))
      trailGeometryRef.current.setDrawRange(0, 1)
      trailGeometryRef.current.computeBoundingSphere()
    }
  }, [trajectory])

  useEffect(() => {
    if (!trajectory.length || !playbackWindow || !sphereRef.current || !trailGeometryRef.current) return
    const trailIndex = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    const head = trajectory[trailIndex]
    sphereRef.current.position.copy(head)
    trailGeometryRef.current.setDrawRange(0, trailIndex + 1)
  }, [playbackIndex, playbackWindow, trajectory])

  const zoom = (factor: number, anchorRatio = 0.5) => {
    if (!points.length) return
    const fullRange = points.length - 1
    const oldSize = Math.max(8, viewEnd - viewStart)
    const nextSize = clamp(Math.round(oldSize * factor), 8, fullRange)
    const anchor = viewStart + oldSize * anchorRatio
    const nextStart = clamp(Math.round(anchor - nextSize * anchorRatio), 0, fullRange - nextSize)
    setViewStart(nextStart)
    setViewEnd(nextStart + nextSize)
  }

  const pan = (deltaSamples: number) => {
    if (!points.length) return
    const fullRange = points.length - 1
    const windowSize = viewEnd - viewStart
    const nextStart = clamp(viewStart + deltaSamples, 0, fullRange - windowSize)
    setViewStart(nextStart)
    setViewEnd(nextStart + windowSize)
  }

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (!parsed.length) {
        setError('No numeric rows found in CSV.')
        setPoints([])
        return
      }
      setPoints(parsed)
      setViewStart(0)
      setViewEnd(parsed.length - 1)
      setPlaybackIndex(0)
      setSelection(null)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
      setPoints([])
    }
  }

  const chartPointerToIndex = (clientX: number, target: SVGSVGElement | null) => {
    if (!target || !points.length) return null
    const bounds = target.getBoundingClientRect()
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    return Math.round(viewStart + ratio * (viewEnd - viewStart))
  }

  const updatePlaybackFromPointer = (clientX: number, target: SVGSVGElement | null) => {
    const index = chartPointerToIndex(clientX, target)
    if (index === null) return
    setPlaying(false)
    setPlaybackIndex(index)
  }

  return (
    <div className="app" ref={chartRef}>
      <header className="toolbar">
        <div>
          <h1>Motion CSV Analyzer</h1>
          <p>timestamp + accel + gyro + gravity with zoom, pan, selection, and playback.</p>
        </div>
        <label className="fileInput">
          <span>Load CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
        </label>
      </header>

      {error && <p className="error">{error}</p>}

      {!points.length ? (
        <section className="emptyState">
          <p>Upload a CSV with columns:</p>
          <code>timestamp,ax,ay,az,gx,gy,gz,grx,gry,grz</code>
        </section>
      ) : (
        <>
          <section className="controls">
            <div className="buttonRow">
              <button onClick={() => zoom(0.75)}>Zoom In</button>
              <button onClick={() => zoom(1.35)}>Zoom Out</button>
              <button
                onClick={() => {
                  setViewStart(0)
                  setViewEnd(points.length - 1)
                }}
              >
                Reset View
              </button>
              <button
                onClick={() => {
                  if (!selection) return
                  const start = Math.min(selection.start, selection.end)
                  const end = Math.max(selection.start, selection.end)
                  if (end > start) {
                    setViewStart(start)
                    setViewEnd(end)
                  }
                }}
                disabled={!selection}
              >
                Zoom To Selection
              </button>
              <button onClick={() => setSelection(null)} disabled={!selection}>
                Clear Selection
              </button>
            </div>

            <label className="scrollRow">
              <span>Scroll window</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, points.length - 1 - viewSize)}
                value={Math.min(viewStart, Math.max(0, points.length - 1 - viewSize))}
                onChange={(e) => {
                  const nextStart = Number(e.target.value)
                  setViewStart(nextStart)
                  setViewEnd(nextStart + viewSize)
                }}
              />
            </label>

            <div className="metaRow">
              <span>
                Samples: <b>{points.length.toLocaleString()}</b>
              </span>
              <span>
                Visible: <b>{(viewEnd - viewStart + 1).toLocaleString()}</b>
              </span>
              <span>
                Range: <b>{fmt(points[viewStart].t)}s</b> to <b>{fmt(points[viewEnd].t)}s</b>
              </span>
              {selection && (
                <span>
                  Selected: <b>{(Math.abs(selection.end - selection.start) + 1).toLocaleString()}</b>
                </span>
              )}
            </div>
          </section>

          {CHART_GROUPS.map((group) => {
            const allSeries = group.keys.map((key) => sampleVisible(points, key, viewStart, viewEnd, chartWidth))
            const yValues = allSeries.flatMap((series) => series.map((p) => p.v))
            const yMin = Math.min(...yValues)
            const yMax = Math.max(...yValues)
            const yPad = (yMax - yMin || 1) * 0.1
            const playheadX =
              ((clamp(playbackIndex, viewStart, viewEnd) - viewStart) / Math.max(1, viewEnd - viewStart)) * chartWidth

            return (
              <section className="chartCard" key={group.title}>
                <div className="cardHeader">
                  <h2>{group.title}</h2>
                  <div className="legend">
                    {group.keys.map((key) => (
                      <span key={key}>
                        <i style={{ background: COLORS[key] }} />
                        {key}
                      </span>
                    ))}
                  </div>
                </div>

                <svg
                  className="chart"
                  width={chartWidth}
                  height={200}
                  onWheel={(e) => {
                    e.preventDefault()
                    const bounds = e.currentTarget.getBoundingClientRect()
                    const ratio = clamp((e.clientX - bounds.left) / bounds.width, 0, 1)
                    if (Math.abs(e.deltaY) < 4) return
                    if (e.ctrlKey || e.metaKey) {
                      zoom(e.deltaY > 0 ? 1.12 : 0.88, ratio)
                    } else {
                      pan(Math.round((e.deltaY / 100) * Math.max(4, viewSize * 0.05)))
                    }
                  }}
                  onPointerDown={(e) => {
                    const index = chartPointerToIndex(e.clientX, e.currentTarget)
                    if (index === null) return
                    setSelectionAnchor(index)
                    setSelection({ start: index, end: index })
                    setIsSelecting(true)
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    if (isScrubbing) {
                      updatePlaybackFromPointer(e.clientX, e.currentTarget)
                      return
                    }
                    if (!isSelecting || selectionAnchor === null) return
                    const index = chartPointerToIndex(e.clientX, e.currentTarget)
                    if (index === null) return
                    setSelection({ start: selectionAnchor, end: index })
                  }}
                  onPointerUp={(e) => {
                    if (isScrubbing) {
                      setIsScrubbing(false)
                      e.currentTarget.releasePointerCapture(e.pointerId)
                      return
                    }
                    if (!isSelecting) return
                    setIsSelecting(false)
                    e.currentTarget.releasePointerCapture(e.pointerId)
                  }}
                >
                  <rect x={0} y={0} width={chartWidth} height={200} className="chartBg" />

                  {[0.25, 0.5, 0.75].map((v) => (
                    <line
                      key={v}
                      x1={0}
                      y1={200 * v}
                      x2={chartWidth}
                      y2={200 * v}
                      className="gridLine"
                    />
                  ))}

                  {group.keys.map((key, idx) => (
                    <path
                      key={key}
                      d={toPath(
                        allSeries[idx],
                        viewStart,
                        viewEnd,
                        yMin - yPad,
                        yMax + yPad,
                        chartWidth,
                        200,
                      )}
                      stroke={COLORS[key]}
                      fill="none"
                      strokeWidth={1.4}
                    />
                  ))}

                  {selection && (
                    <rect
                      className="selection"
                      x={
                        ((Math.min(selection.start, selection.end) - viewStart) / Math.max(1, viewEnd - viewStart)) *
                        chartWidth
                      }
                      y={0}
                      width={
                        (Math.abs(selection.end - selection.start) / Math.max(1, viewEnd - viewStart)) * chartWidth
                      }
                      height={200}
                    />
                  )}

                  <line x1={playheadX} y1={0} x2={playheadX} y2={200} className="playheadLine" />
                  <rect
                    x={playheadX - 7}
                    y={0}
                    width={14}
                    height={200}
                    className="playheadHit"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setPlaying(false)
                      setIsScrubbing(true)
                      updatePlaybackFromPointer(e.clientX, e.currentTarget.ownerSVGElement)
                      if (e.currentTarget.ownerSVGElement) {
                        e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId)
                      }
                    }}
                  />
                </svg>
              </section>
            )
          })}

          <section className="playbackCard">
            <div className="cardHeader">
              <h2>Motion Playback (Three.js Trail)</h2>
              <div className="buttonRow">
                <button
                  onClick={() => {
                    setPlaying(false)
                    setPlaybackSource('view')
                  }}
                  disabled={playbackSource === 'view'}
                >
                  Visible Range
                </button>
                <button
                  onClick={() => {
                    if (!selection) return
                    setPlaying(false)
                    setPlaybackSource('selection')
                  }}
                  disabled={!selection || playbackSource === 'selection'}
                >
                  Selected Range
                </button>
                <button
                  onClick={() => {
                    if (!playbackWindow) return
                    if (playbackIndex < playbackWindow.start || playbackIndex > playbackWindow.end) {
                      setPlaybackIndex(playbackWindow.start)
                    }
                    setPlaying((prev) => !prev)
                  }}
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={() => {
                    if (!playbackWindow) return
                    setPlaying(false)
                    setPlaybackIndex(playbackWindow.start)
                  }}
                >
                  Rewind
                </button>
              </div>
            </div>

            <div className="metaRow">
              <span>
                Playback Source:{' '}
                <b>{playbackSource === 'selection' && selection ? 'Selected Range' : 'Visible Range'}</b>
              </span>
            </div>

            {playbackWindow && (
              <label className="scrollRow">
                <span>Frame</span>
                <input
                  type="range"
                  min={playbackWindow.start}
                  max={playbackWindow.end}
                  value={clamp(playbackIndex, playbackWindow.start, playbackWindow.end)}
                  onChange={(e) => {
                    setPlaying(false)
                    setPlaybackIndex(Number(e.target.value))
                  }}
                />
              </label>
            )}

            {currentPoint && (
              <div className="playbackLayout">
                <div className="motionView" ref={motionViewRef} />

                <div className="readout">
                  <p>
                    t: <b>{fmt(currentPoint.t)}s</b>
                  </p>
                  <p>
                    gravity: <b>{fmt(currentPoint.grx)}</b>, <b>{fmt(currentPoint.gry)}</b>, <b>{fmt(currentPoint.grz)}</b>
                  </p>
                  <p>
                    accel: <b>{fmt(currentPoint.ax)}</b>, <b>{fmt(currentPoint.ay)}</b>, <b>{fmt(currentPoint.az)}</b>
                  </p>
                  <p>
                    gyro: <b>{fmt(currentPoint.gx)}</b>, <b>{fmt(currentPoint.gy)}</b>, <b>{fmt(currentPoint.gz)}</b>
                  </p>
                  {currentTrajectoryPoint && (
                    <p>
                      position: <b>{fmt(currentTrajectoryPoint.x)}</b>, <b>{fmt(currentTrajectoryPoint.y)}</b>,{' '}
                      <b>{fmt(currentTrajectoryPoint.z)}</b>
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default App
