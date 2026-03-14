import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { usePlaybackAudio } from '../hooks/usePlaybackAudio'
import { useThreeTrailScene } from '../hooks/useThreeTrailScene'
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
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true)
  const [showCoordinateLabels, setShowCoordinateLabels] = useState(true)

  const audioRef = usePlaybackAudio({
    audioSrc,
    playbackWindow,
    playbackSamples,
    playbackIndex,
    playing,
    setPlaying,
  })

  const { motionViewRef, rotatedTrajectory, isFullscreen, resetView, toggleFullscreen } = useThreeTrailScene({
    trajectory,
    playbackSamples,
    playbackWindow,
    playbackIndex,
    autoFollowEnabled,
    showCoordinateLabels,
  })

  const resetTarget = useMemo(() => {
    if (playbackWindow && rotatedTrajectory.length) {
      const trailIndex = clamp(playbackIndex - playbackWindow.start, 0, rotatedTrajectory.length - 1)
      return rotatedTrajectory[trailIndex]
    }
    return new THREE.Vector3(0, 0, 0)
  }, [playbackIndex, playbackWindow, rotatedTrajectory])

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
              setAutoFollowEnabled(true)
              resetView(resetTarget)
            }}
          >
            Reset 3D View
          </button>
          <button
            onClick={() => {
              void toggleFullscreen()
            }}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button onClick={() => setShowCoordinateLabels((prev) => !prev)}>
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
            onChange={(event) => {
              setPlaying(false)
              setPlaybackIndex(Number(event.target.value))
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
