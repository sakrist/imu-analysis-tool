import { useEffect, useRef } from 'react'
import { getPlaybackStartIndex, isInteractiveKeyboardTarget } from '../lib/playback'
import type { PlaybackWindow } from '../lib/playback'

type Params = {
  playbackWindow: PlaybackWindow
  playbackIndex: number
  playing: boolean
  setPlaybackIndex: (value: number) => void
  setPlaying: (value: boolean) => void
  clearSelection: () => void
  zoomToSelection: () => void
  resetView: () => void
}

export function useGlobalHotkeys({
  playbackWindow,
  playbackIndex,
  playing,
  setPlaybackIndex,
  setPlaying,
  clearSelection,
  zoomToSelection,
  resetView,
}: Params) {
  const lastEscAtRef = useRef(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const now = performance.now()
        const isDoubleEsc = now - lastEscAtRef.current < 450
        lastEscAtRef.current = now
        clearSelection()
        if (isDoubleEsc) resetView()
        return
      }

      if (event.metaKey && event.key === 'Enter' && !isInteractiveKeyboardTarget(event.target)) {
        event.preventDefault()
        zoomToSelection()
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
  }, [clearSelection, playbackIndex, playbackWindow, playing, resetView, setPlaybackIndex, setPlaying, zoomToSelection])
}
