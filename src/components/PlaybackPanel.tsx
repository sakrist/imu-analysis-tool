import { useId, useMemo, useState, type ChangeEvent } from 'react'
import * as THREE from 'three'
import { usePlaybackAudio } from '../hooks/usePlaybackAudio'
import { usePlaybackVideo } from '../hooks/usePlaybackVideo'
import { useThreeTrailScene } from '../hooks/useThreeTrailScene'
import { getPlaybackStartIndex, type PlaybackWindow, type Selection } from '../lib/playback'
import { clamp, fmt, formatCsvClockTime, formatCsvDateTime } from '../lib/sensor'
import type { Sample } from '../lib/sensor'

type PlaybackPanelProps = {
  selection: Selection
  playbackWindow: PlaybackWindow
  playbackSamples: Sample[]
  audioSrc: string | null
  audioName: string | null
  videoSrc: string | null
  videoName: string | null
  videoOffsetInput: string
  setVideoOffsetInput: (value: string) => void
  videoCreationTimestamp: number | null
  videoMetadataStatus: string
  csvBaseTimestamp: number | null
  onVideoFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  clearVideo: () => void
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
  videoSrc,
  videoName,
  videoOffsetInput,
  setVideoOffsetInput,
  videoCreationTimestamp,
  videoMetadataStatus,
  csvBaseTimestamp,
  onVideoFileChange,
  clearVideo,
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
  const videoInputId = useId()
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true)
  const [showCoordinateLabels, setShowCoordinateLabels] = useState(true)
  const [isVideoDrivingPlayback, setIsVideoDrivingPlayback] = useState(false)
  const parsedVideoOffset = Number(videoOffsetInput)
  const videoOffsetSec = Number.isFinite(parsedVideoOffset) ? parsedVideoOffset : 0

  const audioRef = usePlaybackAudio({
    audioSrc,
    playbackWindow,
    playbackSamples,
    playbackIndex,
    playing,
    setPlaying,
  })
  const videoRef = usePlaybackVideo({
    videoSrc,
    videoOffsetSec,
    currentTimeSec: currentPoint?.t ?? null,
    playing,
    syncFromGraphEnabled: !isVideoDrivingPlayback,
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

  const syncPlaybackIndexFromVideo = (videoTimeSec: number) => {
    if (!playbackWindow || !playbackSamples.length) return

    const targetCsvTimeSec = videoTimeSec + videoOffsetSec
    let nearestIndex = playbackWindow.start
    let nearestDiff = Number.POSITIVE_INFINITY

    for (let localIndex = 0; localIndex < playbackSamples.length; localIndex += 1) {
      const sample = playbackSamples[localIndex]
      const diff = Math.abs(sample.t - targetCsvTimeSec)
      if (diff < nearestDiff) {
        nearestDiff = diff
        nearestIndex = playbackWindow.start + localIndex
      }
    }

    setPlaybackIndex(nearestIndex)
  }

  const stopVideoDrivenPlayback = () => {
    setIsVideoDrivingPlayback(false)
  }

  const alignVideoToCurrentSample = () => {
    if (!videoRef.current || !currentPoint) return
    setVideoOffsetInput((currentPoint.t - videoRef.current.currentTime).toFixed(3))
  }

  const alignVideoFromMetadata = () => {
    if (videoCreationTimestamp === null || csvBaseTimestamp === null) return
    setVideoOffsetInput((videoCreationTimestamp - csvBaseTimestamp).toFixed(3))
  }

  return (
    <section className="playbackCard">
      {audioSrc && <audio ref={audioRef} src={audioSrc} preload="auto" hidden onEnded={() => setPlaying(false)} />}

      <div className="cardHeader">
        <h2>Motion Playback (Three.js Trail)</h2>
        <div className="buttonRow">
          <button
            onClick={() => {
              stopVideoDrivenPlayback()
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
              stopVideoDrivenPlayback()
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
              stopVideoDrivenPlayback()
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
              stopVideoDrivenPlayback()
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
        <span>
          Video: <b>{videoSrc ? videoName ?? 'Loaded' : 'Not loaded'}</b>
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
              stopVideoDrivenPlayback()
              setPlaying(false)
              setPlaybackIndex(Number(event.target.value))
            }}
          />
        </label>
      )}

      <div className="videoSyncSection">
        <div className="labelingHeader">
          <span>Video Sync</span>
          <span>{videoSrc ? 'Linked to CSV time' : 'Load a video to sync'}</span>
        </div>
        <div className="labelingRow">
          <input
            id={videoInputId}
            className="visuallyHiddenInput"
            type="file"
            accept="video/*,.mp4,.mov,.m4v,.webm,.ogv"
            onChange={onVideoFileChange}
          />
          <label className="inlineFileInput" htmlFor={videoInputId}>
            <span>Load Video</span>
          </label>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              clearVideo()
            }}
            disabled={!videoSrc}
          >
            Clear Video
          </button>
          <label className="labeledInput">
            <span>Video Start Offset (s)</span>
            <input
              type="number"
              step={0.01}
              value={videoOffsetInput}
              onChange={(event) => setVideoOffsetInput(event.target.value)}
            />
          </label>
          <button onClick={alignVideoToCurrentSample} disabled={!videoSrc || !currentPoint}>
            Align To Current Sample
          </button>
        </div>
        <p className="labelingHint">
          Set the offset so video time `0` matches the CSV session clock. While paused, scrubbing the graphs seeks the
          video. Once aligned, playback uses the same timestamps as the CSV.
        </p>
        {!!videoMetadataStatus && <p className="labelingHint">{videoMetadataStatus}</p>}
        {videoCreationTimestamp !== null && (
          <div className="metaRow">
            <span>
              Video Metadata Time: <b>{formatCsvDateTime(videoCreationTimestamp)}</b>
            </span>
            <button onClick={alignVideoFromMetadata} disabled={csvBaseTimestamp === null}>
              Use Metadata Align
            </button>
          </div>
        )}
        {videoSrc && (
          <div className="videoPreview">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              preload="metadata"
              playsInline
              onPlay={() => {
                if (videoRef.current) {
                  syncPlaybackIndexFromVideo(videoRef.current.currentTime)
                }
                setPlaying(false)
                setIsVideoDrivingPlayback(true)
              }}
              onPause={() => {
                setPlaying(false)
                setIsVideoDrivingPlayback(false)
              }}
              onEnded={() => {
                setPlaying(false)
                setIsVideoDrivingPlayback(false)
              }}
              onSeeked={() => {
                if (!videoRef.current) return
                syncPlaybackIndexFromVideo(videoRef.current.currentTime)
              }}
              onTimeUpdate={() => {
                if (!videoRef.current) return
                syncPlaybackIndexFromVideo(videoRef.current.currentTime)
              }}
            />
          </div>
        )}
      </div>

      {currentPoint && (
        <div className="playbackLayout">
          <div className="motionView" ref={motionViewRef} />

          <div className="readout">
            <p>
              t: <b>{fmt(currentPoint.t)}s</b>
            </p>
            <p>
              clock: <b>{formatCsvClockTime(currentPoint.timestamp)}</b>
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
