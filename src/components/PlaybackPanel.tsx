import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clamp, fmt } from '../lib/sensor'
import type { Sample } from '../lib/sensor'

type Selection = { start: number; end: number } | null

type PlaybackWindow = { start: number; end: number } | null

type PlaybackPanelProps = {
  selection: Selection
  playbackWindow: PlaybackWindow
  playbackSource: 'view' | 'selection'
  setPlaybackSource: (value: 'view' | 'selection') => void
  playbackIndex: number
  setPlaybackIndex: (value: number) => void
  playing: boolean
  setPlaying: (value: boolean) => void
  currentPoint: Sample | undefined
  currentTrajectoryPoint: THREE.Vector3 | null
  trajectory: THREE.Vector3[]
}

export function PlaybackPanel({
  selection,
  playbackWindow,
  playbackSource,
  setPlaybackSource,
  playbackIndex,
  setPlaybackIndex,
  playing,
  setPlaying,
  currentPoint,
  currentTrajectoryPoint,
  trajectory,
}: PlaybackPanelProps) {
  const motionViewRef = useRef<HTMLDivElement | null>(null)
  const orbitControlsRef = useRef<OrbitControls | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)
  const trailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const ghostTrailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const trajectoryFlat = useMemo(() => {
    if (!trajectory.length) return null
    const flat = new Float32Array(trajectory.length * 3)
    trajectory.forEach((p, i) => {
      flat[i * 3] = p.x
      flat[i * 3 + 1] = p.y
      flat[i * 3 + 2] = p.z
    })
    return flat
  }, [trajectory])

  useEffect(() => {
    const container = motionViewRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#fffaf1')

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(3.2, 2.6, 3.8)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)
    controls.update()
    orbitControlsRef.current = controls

    const ambient = new THREE.AmbientLight(0xffffff, 0.75)
    const directional = new THREE.DirectionalLight(0xffffff, 0.8)
    directional.position.set(3, 5, 2)
    scene.add(ambient, directional)

    const grid = new THREE.GridHelper(4, 10, 0xd1c4ae, 0xe6ddcf)
    scene.add(grid)

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2))
    const box = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xbaa98f, transparent: true, opacity: 0.9 }),
    )
    scene.add(box)

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xe76f51, roughness: 0.35, metalness: 0.1 }),
    )
    scene.add(sphere)
    sphereRef.current = sphere

    const ghostTrailGeometry = new THREE.BufferGeometry()
    ghostTrailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const ghostTrail = new THREE.Line(
      ghostTrailGeometry,
      new THREE.LineBasicMaterial({ color: 0x8b7e6a, transparent: true, opacity: 0.35 }),
    )
    scene.add(ghostTrail)
    ghostTrailGeometryRef.current = ghostTrailGeometry

    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xdc2626 }))
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
      orbitControlsRef.current = null
      cameraRef.current = null
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
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === motionViewRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!trajectoryFlat) return

    if (ghostTrailGeometryRef.current) {
      ghostTrailGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(trajectoryFlat, 3))
      ghostTrailGeometryRef.current.setDrawRange(0, trajectory.length)
      ghostTrailGeometryRef.current.computeBoundingSphere()
    }

    if (trailGeometryRef.current) {
      trailGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(trajectoryFlat.slice(), 3))
      trailGeometryRef.current.setDrawRange(0, 1)
      trailGeometryRef.current.computeBoundingSphere()
    }
  }, [trajectory.length, trajectoryFlat])

  useEffect(() => {
    if (!trajectory.length || !playbackWindow || !sphereRef.current || !trailGeometryRef.current) return
    const trailIndex = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    const head = trajectory[trailIndex]
    sphereRef.current.position.copy(head)
    trailGeometryRef.current.setDrawRange(0, trailIndex + 1)
  }, [playbackIndex, playbackWindow, trajectory])

  return (
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
              if (playing) {
                setPlaying(false)
                return
              }
              if (playbackIndex >= playbackWindow.end) {
                setPlaybackIndex(playbackWindow.start)
                setPlaying(true)
                return
              }
              if (playbackIndex < playbackWindow.start || playbackIndex > playbackWindow.end) {
                setPlaybackIndex(playbackWindow.start)
              }
              setPlaying(true)
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
          <button
            onClick={() => {
              const camera = cameraRef.current
              const controls = orbitControlsRef.current
              if (!camera || !controls) return
              camera.position.set(3.2, 2.6, 3.8)
              controls.target.set(0, 0, 0)
              controls.update()
            }}
          >
            Reset 3D View
          </button>
          <button
            onClick={async () => {
              const container = motionViewRef.current
              if (!container) return
              if (document.fullscreenElement === container) {
                await document.exitFullscreen()
                return
              }
              await container.requestFullscreen()
            }}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      <div className="metaRow">
        <span>
          Playback Source: <b>{playbackSource === 'selection' && selection ? 'Selected Range' : 'Visible Range'}</b>
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
  )
}
