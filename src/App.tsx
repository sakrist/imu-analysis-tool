import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { PlaybackPanel } from './components/PlaybackPanel'
import { SensorChartCard } from './components/SensorChartCard'
import { useChartWidth } from './hooks/useChartWidth'
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys'
import { useObjectUrlFile } from './hooks/useObjectUrlFile'
import { useTimeBasedPlayback } from './hooks/useTimeBasedPlayback'
import { parseLabeledRangesCsv, serializeLabeledRangesCsv, sortLabeledRanges, type LabeledRange } from './lib/labels'
import { type PlaybackSource, normalizeSelection, resolvePlaybackWindow, type Selection } from './lib/playback'
import { CHART_GROUPS, clamp, computeTrajectory, fmt, parseCsv } from './lib/sensor'
import type { Sample } from './lib/sensor'
import './App.css'

const AUDIO_FILE_ACCEPT =
  '.m4a,.wav,.mp3,.caff,.caf,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/mpeg,audio/x-caf,audio/*'

function App() {
  const [points, setPoints] = useState<Sample[]>([])
  const [error, setError] = useState('')
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>('view')
  const [labeledRanges, setLabeledRanges] = useState<LabeledRange[]>([])
  const [rangeLabelInput, setRangeLabelInput] = useState('')
  const [sourceFileName, setSourceFileName] = useState('motion')
  const [isLabelingCollapsed, setIsLabelingCollapsed] = useState(false)
  const [showHotkeysPopover, setShowHotkeysPopover] = useState(false)
  const [chartContainer, setChartContainer] = useState<HTMLDivElement | null>(null)
  const chartWidth = useChartWidth(chartContainer)
  const { fileRef: audioTrack, clear: clearAudioTrack, setFromFile: setAudioFromFile } = useObjectUrlFile()

  const viewSize = Math.max(1, viewEnd - viewStart)

  const playbackWindow = useMemo(
    () => resolvePlaybackWindow(points.length, playbackSource, selection, viewStart, viewEnd),
    [playbackSource, points.length, selection, viewEnd, viewStart],
  )

  const currentPoint = points[clamp(playbackIndex, 0, points.length - 1)]

  const playbackSamples = useMemo(() => {
    if (!playbackWindow) return [] as Sample[]
    return points.slice(playbackWindow.start, playbackWindow.end + 1)
  }, [playbackWindow, points])

  const trajectory = useMemo(() => {
    if (!playbackWindow) return []
    return computeTrajectory(points, playbackWindow.start, playbackWindow.end)
  }, [playbackWindow, points])

  const selectedRangeBounds = useMemo(() => normalizeSelection(selection), [selection])

  const currentTrajectoryPoint = useMemo(() => {
    if (!playbackWindow || !trajectory.length) return null
    const idx = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    return trajectory[idx]
  }, [playbackIndex, playbackWindow, trajectory])

  const selectedSampleCount = selectedRangeBounds ? selectedRangeBounds.end - selectedRangeBounds.start + 1 : 0
  const canAddLabeledRange = Boolean(points.length && selectedRangeBounds && rangeLabelInput.trim())

  const clearSelectionState = useCallback(() => {
    setSelection(null)
    setSelectionAnchor(null)
    setIsSelecting(false)
    setIsScrubbing(false)
  }, [])

  const zoomToSelection = useCallback(() => {
    if (!selectedRangeBounds) return
    if (selectedRangeBounds.end > selectedRangeBounds.start) {
      setViewStart(selectedRangeBounds.start)
      setViewEnd(selectedRangeBounds.end)
    }
    clearSelectionState()
  }, [clearSelectionState, selectedRangeBounds])

  const resetView = useCallback(() => {
    if (!points.length) return
    setViewStart(0)
    setViewEnd(points.length - 1)
  }, [points.length])

  useTimeBasedPlayback({
    points,
    playbackWindow,
    playbackIndex,
    playing,
    setPlaybackIndex,
    setPlaying,
  })

  useGlobalHotkeys({
    playbackWindow,
    playbackIndex,
    playing,
    setPlaybackIndex,
    setPlaying,
    clearSelection: clearSelectionState,
    zoomToSelection,
    resetView,
  })

  const zoom = useCallback(
    (factor: number, anchorRatio = 0.5) => {
      if (!points.length) return
      const fullRange = points.length - 1
      const oldSize = Math.max(8, viewEnd - viewStart)
      const nextSize = clamp(Math.round(oldSize * factor), 8, fullRange)
      const anchor = viewStart + oldSize * anchorRatio
      const nextStart = clamp(Math.round(anchor - nextSize * anchorRatio), 0, fullRange - nextSize)
      setViewStart(nextStart)
      setViewEnd(nextStart + nextSize)
    },
    [points.length, viewEnd, viewStart],
  )

  const pan = useCallback(
    (deltaSamples: number) => {
      if (!points.length) return
      const fullRange = points.length - 1
      const windowSize = viewEnd - viewStart
      const nextStart = clamp(viewStart + deltaSamples, 0, fullRange - windowSize)
      setViewStart(nextStart)
      setViewEnd(nextStart + windowSize)
    },
    [points.length, viewEnd, viewStart],
  )

  const addLabeledRange = useCallback(() => {
    if (!selectedRangeBounds || !points.length) return

    const label = rangeLabelInput.trim()
    if (!label) return

    const startIndex = clamp(selectedRangeBounds.start, 0, points.length - 1)
    const endIndex = clamp(selectedRangeBounds.end, startIndex, points.length - 1)
    const startTimeSec = points[startIndex].t
    const endTimeSec = points[endIndex].t

    const nextRange: LabeledRange = {
      id: `range-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      startIndex,
      endIndex,
      startTimeSec,
      endTimeSec,
      durationSec: Math.max(0, endTimeSec - startTimeSec),
      sampleCount: endIndex - startIndex + 1,
    }

    setLabeledRanges((prev) => sortLabeledRanges([...prev, nextRange]))
  }, [points, rangeLabelInput, selectedRangeBounds])

  const removeLabeledRange = useCallback((id: string) => {
    setLabeledRanges((prev) => prev.filter((range) => range.id !== id))
  }, [])

  const exportLabeledRanges = useCallback(() => {
    if (!labeledRanges.length) return

    const csv = serializeLabeledRangesCsv(labeledRanges)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const base = sourceFileName.replace(/\.[^/.]+$/, '') || 'motion'
    link.href = url
    link.download = `${base}-labeled-ranges.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [labeledRanges, sourceFileName])

  const onLabelsFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const imported = parseLabeledRangesCsv(text, points)
        setLabeledRanges((prev) => sortLabeledRanges([...prev, ...imported]))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse labels CSV')
      } finally {
        event.target.value = ''
      }
    },
    [points],
  )

  const onFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setSourceFileName(file.name)
      const text = await file.text()
      const parsed = parseCsv(text)
      if (!parsed.length) {
        setError('No numeric rows found in CSV.')
        setPoints([])
        setLabeledRanges([])
        return
      }

      setPoints(parsed)
      setViewStart(0)
      setViewEnd(parsed.length - 1)
      setPlaybackIndex(0)
      setSelection(null)
      setPlaying(false)
      setPlaybackSource('view')
      setLabeledRanges([])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
      setPoints([])
      setLabeledRanges([])
    }
  }, [])

  const onAudioFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setAudioFromFile(event.target.files?.[0])
      event.target.value = ''
    },
    [setAudioFromFile],
  )

  return (
    <div className="app">
      <header className="toolbar">
        <div>
          <h1>IMU Motion CSV Analyzer + labeler</h1>
          <p>timestamp + accel + gyro + gravity with zoom, pan, selection, and playback.</p>
        </div>
        <div className="toolbarActions">
          <label className="fileInput">
            <span>Load CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
          </label>
          <label className="fileInput">
            <span>Load Audio</span>
            <input type="file" accept={AUDIO_FILE_ACCEPT} onChange={onAudioFileChange} />
          </label>
          <button onClick={clearAudioTrack} disabled={!audioTrack}>
            Clear Audio
          </button>
          <div className="hotkeysPopoverWrap">
            <button
              className="iconButton"
              aria-label="Keyboard shortcuts"
              aria-expanded={showHotkeysPopover}
              onClick={() => setShowHotkeysPopover((prev) => !prev)}
            >
              i
            </button>
            {showHotkeysPopover && (
              <div className="hotkeysPopover" role="dialog" aria-label="Keyboard shortcuts">
                <h3>Hotkeys</h3>
                <p>
                  <kbd>Space</kbd>: Play/Pause
                </p>
                <p>
                  <kbd>Esc</kbd>: Clear selection
                </p>
                <p>
                  <kbd>Esc</kbd> twice: Reset view
                </p>
                <p>
                  <kbd>Cmd</kbd> + <kbd>Enter</kbd>: Zoom to selection
                </p>
                <p>
                  <kbd>Ctrl/Cmd</kbd> + wheel: Zoom graph
                </p>
                <p>
                  <kbd>Alt</kbd> + wheel: Pan graph
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {!points.length ? (
        <section className="emptyState">
          <p>Upload a CSV with columns:</p>
          <code>timestamp,ax,ay,az,gx,gy,gz,grx,gry,grz</code>
        </section>
      ) : (
        <section className="workspaceGrid">
          <div className="workspaceLeft">
            <PlaybackPanel
              selection={selection}
              playbackWindow={playbackWindow}
              playbackSamples={playbackSamples}
              playbackSource={playbackSource}
              setPlaybackSource={setPlaybackSource}
              playbackIndex={playbackIndex}
              setPlaybackIndex={setPlaybackIndex}
              playing={playing}
              setPlaying={setPlaying}
              currentPoint={currentPoint}
              currentTrajectoryPoint={currentTrajectoryPoint}
              trajectory={trajectory}
              audioSrc={audioTrack?.url ?? null}
              audioName={audioTrack?.name ?? null}
            />
          </div>

          <div className="workspaceRight" ref={setChartContainer}>
            <section className="controls">
              <div className="buttonRow">
                <button onClick={() => zoom(0.75)}>Zoom In</button>
                <button onClick={() => zoom(1.35)}>Zoom Out</button>
                <button onClick={resetView}>
                  Reset View
                </button>
                <button
                  onClick={zoomToSelection}
                  disabled={!selection}
                >
                  Zoom To Selection
                </button>
                <button onClick={clearSelectionState} disabled={!selection}>
                  Clear Selection
                </button>
              </div>

              <label className="scrollRow">
                <span>Scroll window</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, points.length - 1 - viewSize)}
                  value={Math.min(viewStart, Math.max(0, points.length - 1 - viewSize))}
                  onChange={(event) => {
                    const nextStart = Number(event.target.value)
                    setViewStart(nextStart)
                    setViewEnd(nextStart + viewSize)
                  }}
                />
              </label>

              <div className="metaRow">
                <span>
                  Samples: <b>{points.length.toLocaleString()}</b>
                </span>
                <span>
                  Visible: <b>{(viewEnd - viewStart + 1).toLocaleString()}</b>
                </span>
                <span>
                  Range: <b>{fmt(points[viewStart].t)}s</b> to <b>{fmt(points[viewEnd].t)}s</b>
                </span>
                {selection && (
                  <span>
                    Selected: <b>{(Math.abs(selection.end - selection.start) + 1).toLocaleString()}</b>
                  </span>
                )}
                <span>
                  Labeled Ranges: <b>{labeledRanges.length}</b>
                </span>
              </div>
            </section>

            <section className="labelingCard">
              <div className="labelingHeader">
                <button
                  className="collapseToggle"
                  onClick={() => setIsLabelingCollapsed((prev) => !prev)}
                  aria-expanded={!isLabelingCollapsed}
                  aria-label={`${isLabelingCollapsed ? 'Expand' : 'Collapse'} Manual Labels`}
                >
                  <span>{isLabelingCollapsed ? '▸' : '▾'}</span>
                  <span>Manual Labels</span>
                </button>
                <span>{labeledRanges.length.toLocaleString()} saved</span>
              </div>
              {!isLabelingCollapsed && (
                <div className="labelingBody">
                  <div className="labelingRow">
                    <input
                      value={rangeLabelInput}
                      onChange={(event) => setRangeLabelInput(event.target.value)}
                      placeholder="Label name (e.g. run, swing, walk)"
                    />
                    <button onClick={addLabeledRange} disabled={!canAddLabeledRange}>
                      Add Selected Range
                    </button>
                    <button onClick={() => setLabeledRanges([])} disabled={!labeledRanges.length}>
                      Clear Labels
                    </button>
                    <button onClick={exportLabeledRanges} disabled={!labeledRanges.length}>
                      Export Labels CSV
                    </button>
                    <label className="inlineFileInput">
                      <span>Load Labels CSV</span>
                      <input type="file" accept=".csv,text/csv" onChange={onLabelsFileChange} />
                    </label>
                  </div>
                  <p className="labelingHint">
                    {selectedRangeBounds
                      ? `Selected ${selectedSampleCount.toLocaleString()} samples (${fmt(
                          points[selectedRangeBounds.start].t,
                        )}s to ${fmt(points[selectedRangeBounds.end].t)}s)`
                      : 'Drag on any chart to select a range, then add a label.'}
                  </p>
                  {!!labeledRanges.length && (
                    <div className="rangeList">
                      {labeledRanges.map((range) => (
                        <div key={range.id} className="rangeListItem">
                          <span>
                            <b>{range.label}</b> [{range.startIndex}-{range.endIndex}] {fmt(range.startTimeSec)}s to{' '}
                            {fmt(range.endTimeSec)}s ({range.sampleCount.toLocaleString()} samples)
                          </span>
                          <button onClick={() => removeLabeledRange(range.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {CHART_GROUPS.map((group) => (
              <SensorChartCard
                key={group.title}
                title={group.title}
                keys={group.keys}
                unit={group.unit}
                fixedYDomain={group.yDomain}
                points={points}
                chartWidth={chartWidth}
                viewStart={viewStart}
                viewEnd={viewEnd}
                viewSize={viewSize}
                selection={selection}
                selectionAnchor={selectionAnchor}
                isSelecting={isSelecting}
                isScrubbing={isScrubbing}
                playbackIndex={playbackIndex}
                motionRanges={labeledRanges}
                setIsSelecting={setIsSelecting}
                setSelectionAnchor={setSelectionAnchor}
                setSelection={setSelection}
                setIsScrubbing={setIsScrubbing}
                clearSelectionState={clearSelectionState}
                setPlaying={setPlaying}
                setPlaybackIndex={setPlaybackIndex}
                zoom={zoom}
                pan={pan}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default App
