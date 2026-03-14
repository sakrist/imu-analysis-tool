import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clamp } from '../lib/sensor'
import type { PlaybackWindow } from '../lib/playback'
import type { Sample } from '../lib/sensor'

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

type Params = {
  trajectory: THREE.Vector3[]
  playbackSamples: Sample[]
  playbackWindow: PlaybackWindow
  playbackIndex: number
  autoFollowEnabled: boolean
  showCoordinateLabels: boolean
}

export function useThreeTrailScene({
  trajectory,
  playbackSamples,
  playbackWindow,
  playbackIndex,
  autoFollowEnabled,
  showCoordinateLabels,
}: Params) {
  const motionViewRef = useRef<HTMLDivElement | null>(null)
  const orbitControlsRef = useRef<OrbitControls | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const boxRef = useRef<THREE.LineSegments | null>(null)
  const markerGroupRef = useRef<THREE.Group | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)
  const trailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const ghostTrailGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const followOffsetRef = useRef(FOLLOW_OFFSET.clone())
  const [isFullscreen, setIsFullscreen] = useState(false)

  const rotatedTrajectory = useMemo(() => {
    if (!trajectory.length) return []
    return trajectory
  }, [trajectory])

  const trajectoryFlat = useMemo(() => {
    if (!rotatedTrajectory.length) return null
    const flat = new Float32Array(rotatedTrajectory.length * 3)
    rotatedTrajectory.forEach((point, index) => {
      flat[index * 3] = point.x
      flat[index * 3 + 1] = point.y
      flat[index * 3 + 2] = point.z
    })
    return flat
  }, [rotatedTrajectory])

  useEffect(() => {
    const container = motionViewRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#fffaf1')

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.copy(FOLLOW_OFFSET)
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

    const resize = () => {
      const width = Math.max(220, container.clientWidth)
      const height = Math.max(240, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    let rafId = 0
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
    const markerGroup = markerGroupRef.current
    if (!markerGroup) return

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

      const position = rotatedTrajectory[i]
      const axes = new THREE.AxesHelper(0.16)
      axes.position.copy(position)
      markerGroup.add(axes)

      if (showCoordinateLabels) {
        const label = createLabelSprite(`x:${position.x.toFixed(2)} y:${position.y.toFixed(2)} z:${position.z.toFixed(2)}`)
        if (label) {
          label.position.copy(position).add(new THREE.Vector3(0.2, 0.2, 0))
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

  const resetView = useCallback((target?: THREE.Vector3) => {
    const camera = cameraRef.current
    const controls = orbitControlsRef.current
    if (!camera || !controls) return
    const safeTarget = target ?? new THREE.Vector3(0, 0, 0)
    controls.target.copy(safeTarget)
    camera.position.copy(safeTarget).add(followOffsetRef.current)
    controls.update()
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const container = motionViewRef.current
    if (!container) return
    if (document.fullscreenElement === container) {
      await document.exitFullscreen()
      return
    }
    await container.requestFullscreen()
  }, [])

  return {
    motionViewRef,
    rotatedTrajectory,
    isFullscreen,
    resetView,
    toggleFullscreen,
  }
}
