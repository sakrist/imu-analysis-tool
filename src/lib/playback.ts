export type Selection = { start: number; end: number } | null

export type PlaybackWindow = { start: number; end: number } | null

export type PlaybackSource = 'view' | 'selection'

export function normalizeSelection(selection: Selection) {
  if (!selection) return null
  return {
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  }
}

export function resolvePlaybackWindow(
  pointsLength: number,
  playbackSource: PlaybackSource,
  selection: Selection,
  viewStart: number,
  viewEnd: number,
): PlaybackWindow {
  if (!pointsLength) return null
  if (playbackSource === 'selection') {
    const selected = normalizeSelection(selection)
    if (selected) return selected
  }
  return { start: viewStart, end: viewEnd }
}

export function getPlaybackStartIndex(playbackIndex: number, playbackWindow: PlaybackWindow) {
  if (!playbackWindow) return playbackIndex
  if (playbackIndex >= playbackWindow.end) return playbackWindow.start
  if (playbackIndex < playbackWindow.start || playbackIndex > playbackWindow.end) return playbackWindow.start
  return playbackIndex
}

export function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}
