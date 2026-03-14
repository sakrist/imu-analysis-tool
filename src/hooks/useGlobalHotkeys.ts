import { useEffect } from 'react'
import { getPlaybackStartIndex, isInteractiveKeyboardTarget } from '../lib/playback'
import type { PlaybackWindow } from '../lib/playback'

type Params = {
  playbackWindow: PlaybackWindow
  playbackIndex: number
  playing: boolean
  setPlaybackIndex: (value: number) => void
  setPlaying: (value: boolean) => void
  clearSelection: () => void
}

export function useGlobalHotkeys({
  playbackWindow,
  playbackIndex,
  playing,
  setPlaybackIndex,
  setPlaying,
  clearSelection,
}: Params) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection()
        return
      }

      if (event.code !== 'Space' || isInteractiveKeyboardTarget(event.target)) return

      event.preventDefault()
      if (!playbackWindow) return

      if (playing) {
        setPlaying(false)
        return
      }

      setPlaybackIndex(getPlaybackStartIndex(playbackIndex, playbackWindow))
      setPlaying(true)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, playbackIndex, playbackWindow, playing, setPlaybackIndex, setPlaying])
}
