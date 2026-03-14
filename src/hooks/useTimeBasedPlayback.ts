import { useEffect, useRef } from 'react'
import { clamp } from '../lib/sensor'
import type { Sample } from '../lib/sensor'
import type { PlaybackWindow } from '../lib/playback'

type Params = {
  points: Sample[]
  playbackWindow: PlaybackWindow
  playbackIndex: number
  playing: boolean
  setPlaybackIndex: (value: number | ((prev: number) => number)) => void
  setPlaying: (value: boolean) => void
}

export function useTimeBasedPlayback({
  points,
  playbackWindow,
  playbackIndex,
  playing,
  setPlaybackIndex,
  setPlaying,
}: Params) {
  const playbackIndexRef = useRef(playbackIndex)

  useEffect(() => {
    playbackIndexRef.current = playbackIndex
  }, [playbackIndex])

  useEffect(() => {
    if (!playbackWindow || !points.length || !playing) return
    const windowStart = playbackWindow.start
    const windowEnd = playbackWindow.end
    if (windowEnd <= windowStart) {
      setPlaybackIndex(windowStart)
      setPlaying(false)
      return
    }

    const startIndex = clamp(playbackIndexRef.current, windowStart, windowEnd)
    const startTimeSec = points[startIndex].t
    const perfStartMs = performance.now()

    // Use time-based playback (vs. fixed +1 index steps) so chart/3D timing follows
    // real sample timestamps.
    const findIndexAtOrBeforeTime = (targetTimeSec: number) => {
      let lo = windowStart
      let hi = windowEnd
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (points[mid].t <= targetTimeSec) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }
      return lo
    }

    let rafId = 0
    const tick = () => {
      const elapsedSec = (performance.now() - perfStartMs) / 1000
      const targetTimeSec = startTimeSec + elapsedSec
      const nextIndex = findIndexAtOrBeforeTime(targetTimeSec)

      if (nextIndex >= windowEnd) {
        setPlaybackIndex(windowEnd)
        setPlaying(false)
        return
      }

      setPlaybackIndex((prev) => (prev === nextIndex ? prev : nextIndex))
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playbackWindow, playing, points, setPlaybackIndex, setPlaying])
}
