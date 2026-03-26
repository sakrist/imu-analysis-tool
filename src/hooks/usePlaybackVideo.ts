import { useEffect, useRef } from 'react'
import { clamp } from '../lib/sensor'

type Params = {
  videoSrc: string | null
  videoOffsetSec: number
  currentTimeSec: number | null
  playing: boolean
  syncFromGraphEnabled: boolean
}

export function usePlaybackVideo({ videoSrc, videoOffsetSec, currentTimeSec, playing, syncFromGraphEnabled }: Params) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const currentTimeRef = useRef(currentTimeSec)

  useEffect(() => {
    currentTimeRef.current = currentTimeSec
  }, [currentTimeSec])

  const syncVideoPosition = (seekThresholdSec: number) => {
    const video = videoRef.current
    const csvTimeSec = currentTimeRef.current
    if (!video || !videoSrc || csvTimeSec === null) return false

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const rawTargetTimeSec = csvTimeSec - videoOffsetSec
    const boundedTargetTimeSec = duration
      ? clamp(rawTargetTimeSec, 0, duration)
      : Math.max(0, rawTargetTimeSec)

    if (Math.abs(video.currentTime - boundedTargetTimeSec) > seekThresholdSec) {
      video.currentTime = boundedTargetTimeSec
    }

    return rawTargetTimeSec >= 0 && (!duration || rawTargetTimeSec <= duration)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoSrc || playing || !syncFromGraphEnabled) return

    video.pause()
    const syncOnceReady = () => {
      syncVideoPosition(0.02)
    }

    if (video.readyState < 1) {
      video.addEventListener('loadedmetadata', syncOnceReady)
      return () => video.removeEventListener('loadedmetadata', syncOnceReady)
    }

    syncOnceReady()
  }, [currentTimeSec, playing, syncFromGraphEnabled, videoOffsetSec, videoSrc])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoSrc || !playing || !syncFromGraphEnabled) return

    let cancelled = false
    let rafId = 0

    const tick = async () => {
      if (cancelled) return

      const inRange = syncVideoPosition(0.1)
      if (!inRange) {
        video.pause()
        rafId = requestAnimationFrame(() => void tick())
        return
      }

      if (video.paused) {
        try {
          await video.play()
        } catch {
          return
        }
      }

      rafId = requestAnimationFrame(() => void tick())
    }

    const startOnceReady = () => {
      void tick()
    }

    if (video.readyState < 1) {
      video.addEventListener('loadedmetadata', startOnceReady)
      return () => {
        cancelled = true
        cancelAnimationFrame(rafId)
        video.removeEventListener('loadedmetadata', startOnceReady)
      }
    }

    void tick()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [playing, syncFromGraphEnabled, videoOffsetSec, videoSrc])

  return videoRef
}
