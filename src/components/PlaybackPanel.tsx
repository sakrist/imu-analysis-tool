import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { getPlaybackStartIndex, type PlaybackWindow, type Selection } from '../lib/playback'
import { clamp, fmt } from '../lib/sensor'
import type { Sample } from '../lib/sensor'

type PlaybackPanelProps = {
  selection: Selection
  playbackWindow: PlaybackWindow
  playbackSamples: Sample[]
  audioSrc: string | null
  audioName: string | null
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

const FOLLOW_OFFSET = new THREE.Vector3(3.2, 2.6, 3.8)

function clearMarkerGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children.pop()
    if (!child) break

    const withGeometry = child as THREE.Object3D & { geometry?: THREE.BufferGeometry }
    if (withGeometry.geometry) withGeometry.geometry.dispose()

    const withMaterial = child as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    if (withMaterial.material) {
      if (Array.isArray(withMaterial.material)) {
        withMaterial.material.forEach((material) => material.dispose())
      } else {
        withMaterial.material.dispose()
      }
    }

    if (child instanceof THREE.Sprite) {
      const spriteMaterial = child.material as THREE.SpriteMaterial
      spriteMaterial.map?.dispose()
    }
  }
}

function createLabelSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 560
  canvas.height = 110
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = 'rgba(255, 250, 241, 0.92)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = 'rgba(109, 102, 93, 0.75)'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
  ctx.fillStyle = '#161514'
  ctx.font = 'bold 34px "IBM Plex Sans", sans-serif'
  ctx.fillText(text, 20, 68)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.95, 0.18, 1)
  sprite.renderOrder = 10
  return sprite
}

export function PlaybackPanel({
  selection,
  playbackWindow,
  playbackSamples,
  audioSrc,
  audioName,
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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wasPlayingRef = useRef(false)
  const orbitControlsRef = useRef<OrbitControls | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const boxRef = useRef<THREE.LineSegments | null>(null)
  const markerGroupRef = useRef<THREE.Group | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)
  const trailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const ghostTrailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true)
  const [showCoordinateLabels, setShowCoordinateLabels] = useState(true)
  const followOffsetRef = useRef(FOLLOW_OFFSET.clone())
  const rotatedTrajectory = useMemo(() => {
    if (!trajectory.length) return []
    return trajectory
    // const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    // return trajectory.map((point) => point.clone().applyQuaternion(rotation))
  }, [trajectory])

  const trajectoryFlat = useMemo(() => {
    if (!rotatedTrajectory.length) return null
    const flat = new Float32Array(rotatedTrajectory.length * 3)
    rotatedTrajectory.forEach((p, i) => {
      flat[i * 3] = p.x
      flat[i * 3 + 1] = p.y
      flat[i * 3 + 2] = p.z
    })
    return flat
  }, [rotatedTrajectory])

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
    const onControlsChange = () => {
      followOffsetRef.current.copy(camera.position).sub(controls.target)
    }
    controls.addEventListener('change', onControlsChange)

    const ambient = new THREE.AmbientLight(0xffffff, 0.75)
    const directional = new THREE.DirectionalLight(0xffffff, 0.8)
    directional.position.set(3, 5, 2)
    scene.add(ambient, directional)

    const grid = new THREE.GridHelper(4, 10, 0xd1c4ae, 0xe6ddcf)
    scene.add(grid)
    gridRef.current = grid

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2))
    const box = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xbaa98f, transparent: true, opacity: 0.9 }),
    )
    scene.add(box)
    boxRef.current = box

    const markerGroup = new THREE.Group()
    scene.add(markerGroup)
    markerGroupRef.current = markerGroup

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
      gridRef.current = null
      boxRef.current = null
      markerGroupRef.current = null
      trailGeometryRef.current = null
      ghostTrailGeometryRef.current = null
      scene.remove(sphere, trail, ghostTrail, box, grid, ambient, directional)
      clearMarkerGroup(markerGroup)
      scene.remove(markerGroup)
      ;(sphere.geometry as THREE.BufferGeometry).dispose()
      ;(sphere.material as THREE.Material).dispose()
      trailGeometry.dispose()
      ;(trail.material as THREE.Material).dispose()
      ghostTrailGeometry.dispose()
      ;(ghostTrail.material as THREE.Material).dispose()
      edges.dispose()
      controls.removeEventListener('change', onControlsChange)
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
      ghostTrailGeometryRef.current.setDrawRange(0, rotatedTrajectory.length)
      ghostTrailGeometryRef.current.computeBoundingSphere()
    }

    if (trailGeometryRef.current) {
      trailGeometryRef.current.setAttribute('position', new THREE.BufferAttribute(trajectoryFlat.slice(), 3))
      trailGeometryRef.current.setDrawRange(0, 1)
      trailGeometryRef.current.computeBoundingSphere()
    }
  }, [rotatedTrajectory.length, trajectoryFlat])

  useEffect(() => {
    if (!markerGroupRef.current) return

    const markerGroup = markerGroupRef.current
    clearMarkerGroup(markerGroup)

    if (!rotatedTrajectory.length || !playbackSamples.length) return

    const intervalSeconds = 2
    const startTime = playbackSamples[0].t
    let nextMarkTime = startTime + intervalSeconds

    for (let i = 0; i < rotatedTrajectory.length; i += 1) {
      const isFirst = i === 0
      const isLast = i === rotatedTrajectory.length - 1
      const shouldMark = isFirst || isLast || playbackSamples[i].t >= nextMarkTime
      if (!shouldMark) continue

      const pos = rotatedTrajectory[i]
      const axes = new THREE.AxesHelper(0.16)
      axes.position.copy(pos)
      markerGroup.add(axes)

      if (showCoordinateLabels) {
        const label = createLabelSprite(`x:${pos.x.toFixed(2)} y:${pos.y.toFixed(2)} z:${pos.z.toFixed(2)}`)
        if (label) {
          label.position.copy(pos).add(new THREE.Vector3(0.2, 0.2, 0))
          markerGroup.add(label)
        }
      }

      while (playbackSamples[i].t >= nextMarkTime) {
        nextMarkTime += intervalSeconds
      }
    }
  }, [playbackSamples, rotatedTrajectory, showCoordinateLabels])

  useEffect(() => {
    if (!rotatedTrajectory.length || !playbackWindow || !sphereRef.current || !trailGeometryRef.current) return
    const trailIndex = clamp(playbackIndex - playbackWindow.start, 0, rotatedTrajectory.length - 1)
    const head = rotatedTrajectory[trailIndex]
    sphereRef.current.position.copy(head)
    trailGeometryRef.current.setDrawRange(0, trailIndex + 1)
    if (gridRef.current) gridRef.current.position.copy(head)
    if (boxRef.current) boxRef.current.position.copy(head)

    if (autoFollowEnabled && orbitControlsRef.current && cameraRef.current) {
      orbitControlsRef.current.target.copy(head)
      cameraRef.current.position.copy(head).add(followOffsetRef.current)
      orbitControlsRef.current.update()
    }
  }, [autoFollowEnabled, playbackIndex, playbackWindow, rotatedTrajectory])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc) return

    if (!playing) {
      audio.pause()
      wasPlayingRef.current = false
      return
    }

    if (wasPlayingRef.current) return

    const localIndex =
      playbackWindow && playbackSamples.length
        ? clamp(playbackIndex - playbackWindow.start, 0, playbackSamples.length - 1)
        : 0
    const startTimeSec = playbackSamples[localIndex]?.t ?? 0

    // Seek once when playback starts so audio matches current CSV/playback window position.
    // While playing, do not continuously seek to avoid jitter.
    const playFromCurrentPosition = async () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = clamp(startTimeSec, 0, audio.duration)
      } else {
        audio.currentTime = Math.max(0, startTimeSec)
      }
      try {
        await audio.play()
        wasPlayingRef.current = true
      } catch {
        wasPlayingRef.current = false
        setPlaying(false)
      }
    }

    if (audio.readyState < 1) {
      const onLoadedMetadata = () => {
        audio.removeEventListener('loadedmetadata', onLoadedMetadata)
        void playFromCurrentPosition()
      }
      audio.addEventListener('loadedmetadata', onLoadedMetadata)
      return () => audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }

    void playFromCurrentPosition()
  }, [audioSrc, playbackIndex, playbackSamples, playbackWindow, playing, setPlaying])

  return (
    <section className="playbackCard">
      {audioSrc && <audio ref={audioRef} src={audioSrc} preload="auto" hidden onEnded={() => setPlaying(false)} />}

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
              setPlaybackIndex(getPlaybackStartIndex(playbackIndex, playbackWindow))
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
              const target =
                playbackWindow && rotatedTrajectory.length
                  ? rotatedTrajectory[clamp(playbackIndex - playbackWindow.start, 0, rotatedTrajectory.length - 1)]
                  : new THREE.Vector3(0, 0, 0)
              controls.target.copy(target)
              camera.position.copy(target).add(followOffsetRef.current)
              setAutoFollowEnabled(true)
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
          <button
            onClick={() => {
              setShowCoordinateLabels((prev) => !prev)
            }}
          >
            {showCoordinateLabels ? 'Hide 3D Labels' : 'Show 3D Labels'}
          </button>
        </div>
      </div>

      <div className="metaRow">
        <span>
          Playback Source: <b>{playbackSource === 'selection' && selection ? 'Selected Range' : 'Visible Range'}</b>
        </span>
        <span>
          Camera: <b>{autoFollowEnabled ? 'Auto Follow' : 'Manual'}</b>
        </span>
        <span>
          Labels: <b>{showCoordinateLabels ? 'Visible' : 'Hidden'}</b>
        </span>
        <span>
          Audio: <b>{audioSrc ? audioName ?? 'Loaded' : 'Not loaded'}</b>
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
