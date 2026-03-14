import { useEffect, useRef } from 'react'
import { clamp } from '../lib/sensor'
import type { PlaybackWindow } from '../lib/playback'
import type { Sample } from '../lib/sensor'

type Params = {
  audioSrc: string | null
  playbackWindow: PlaybackWindow
  playbackSamples: Sample[]
  playbackIndex: number
  playing: boolean
  setPlaying: (value: boolean) => void
}

export function usePlaybackAudio({
  audioSrc,
  playbackWindow,
  playbackSamples,
  playbackIndex,
  playing,
  setPlaying,
}: Params) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wasPlayingRef = useRef(false)

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

  return audioRef
}
