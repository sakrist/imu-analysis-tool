import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
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
import { computeStrikeWindowMetrics } from './lib/strikeMetrics'
import {
  buildPredictedStrikeRanges,
  hasStrikeModelArtifact,
  inferStrikeWindows,
  type PredictedStrikeRange,
  type StrikeInferenceResult,
} from './lib/strikeModel'
import './App.css'

const AUDIO_FILE_ACCEPT =
  '.m4a,.wav,.mp3,.caff,.caf,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/mpeg,audio/x-caf,audio/*'

const STRIKE_METRIC_INFO = {
  peakAccMag: 'Highest acceleration magnitude inside the selected strike window. This is the strongest instantaneous acceleration seen during the strike.',
  peakGyroMag: 'Highest gyroscope magnitude inside the selected strike window. This captures the fastest rotational motion during the strike.',
  peakJerk: 'Largest sample-to-sample change in acceleration divided by time. Higher jerk usually means a sharper, more abrupt impact.',
  strikeDuration:
    'Duration of the tighter strike event around impact, recalculated from very high acceleration plus elevated rotation. This is not the full padded ML window.',
  preImpactDuration:
    'Time from the recalculated strike start to impact. This is the pre-impact portion of the tighter strike event.',
  postImpactDuration:
    'Time from impact to the recalculated strike end. This is the after-impact portion of the tighter strike event.',
  preImpactSpeedProxy:
    'A short pre-impact integral of acceleration magnitude over the 150 ms before impact. It is a relative speed proxy, not a true measured velocity.',
} satisfies Record<string, string>

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
  const [cursorSelectionRadiusInput, setCursorSelectionRadiusInput] = useState('50')
  const [sourceFileName, setSourceFileName] = useState('motion')
  const [isStrikeModelCollapsed, setIsStrikeModelCollapsed] = useState(false)
  const [isLabelingCollapsed, setIsLabelingCollapsed] = useState(false)
  const [showHotkeysPopover, setShowHotkeysPopover] = useState(false)
  const [strikeInference, setStrikeInference] = useState<StrikeInferenceResult | null>(null)
  const [isStrikeModelAvailable, setIsStrikeModelAvailable] = useState(false)
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelError, setModelError] = useState('')
  const [predictionThresholdInput, setPredictionThresholdInput] = useState('0.50')
  const [showModelPredictions, setShowModelPredictions] = useState(true)
  const [openMetricInfo, setOpenMetricInfo] = useState<keyof typeof STRIKE_METRIC_INFO | null>(null)
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
  const parsedPredictionThreshold = Number(predictionThresholdInput)
  const predictionThreshold = Number.isFinite(parsedPredictionThreshold)
    ? clamp(parsedPredictionThreshold, 0, 1)
    : strikeInference?.defaultThreshold ?? 0.5

  const predictedRanges = useMemo(
    () =>
      strikeInference
        ? buildPredictedStrikeRanges(points, strikeInference.windowPredictions, predictionThreshold, strikeInference.stride)
        : [],
    [points, predictionThreshold, strikeInference],
  )

  const positivePredictionCount = useMemo(
    () =>
      strikeInference
        ? strikeInference.windowPredictions.filter((prediction) => prediction.probability >= predictionThreshold).length
        : 0,
    [predictionThreshold, strikeInference],
  )

  const chartRanges = useMemo(
    () => (showModelPredictions ? sortLabeledRanges([...labeledRanges, ...predictedRanges]) : labeledRanges),
    [labeledRanges, predictedRanges, showModelPredictions],
  )

  const currentTrajectoryPoint = useMemo(() => {
    if (!playbackWindow || !trajectory.length) return null
    const idx = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    return trajectory[idx]
  }, [playbackIndex, playbackWindow, trajectory])

  const selectedSampleCount = selectedRangeBounds ? selectedRangeBounds.end - selectedRangeBounds.start + 1 : 0
  const canAddLabeledRange = Boolean(points.length && selectedRangeBounds && rangeLabelInput.trim())
  const parsedCursorSelectionRadius = Number(cursorSelectionRadiusInput)
  const cursorSelectionRadius = Number.isFinite(parsedCursorSelectionRadius)
    ? Math.max(0, Math.floor(parsedCursorSelectionRadius))
    : null
  const canSelectAroundCursor = points.length > 0 && cursorSelectionRadius !== null
  const shouldShowStrikeModel = isStrikeModelAvailable && modelStatus !== 'error'
  const selectedPredictedRange = useMemo(() => {
    if (!selectedRangeBounds) return null
    return (
      predictedRanges.find(
        (range) => range.startIndex === selectedRangeBounds.start && range.endIndex === selectedRangeBounds.end,
      ) ?? null
    )
  }, [predictedRanges, selectedRangeBounds])
  const selectedPredictedRangeMetrics = useMemo(
    () =>
      selectedPredictedRange
        ? computeStrikeWindowMetrics(points, selectedPredictedRange.startIndex, selectedPredictedRange.endIndex)
        : null,
    [points, selectedPredictedRange],
  )
  const selectedStrikeOverlay = useMemo(
    () =>
      selectedPredictedRangeMetrics
        ? {
            strikeStartIndex: selectedPredictedRangeMetrics.strikeStartIndex,
            impactIndex: selectedPredictedRangeMetrics.impactIndex,
            strikeEndIndex: selectedPredictedRangeMetrics.strikeEndIndex,
          }
        : null,
    [selectedPredictedRangeMetrics],
  )
  const selectedPredictedMetricItems = useMemo(() => {
    if (!selectedPredictedRangeMetrics) return []

    return [
      {
        id: 'peakAccMag' as const,
        label: 'Peak Acc Magnitude',
        value: `${fmt(selectedPredictedRangeMetrics.peakAccMagG)} g`,
      },
      {
        id: 'peakGyroMag' as const,
        label: 'Peak Gyro Magnitude',
        value: `${fmt(selectedPredictedRangeMetrics.peakGyroMagRadPerSec)} rad/s`,
      },
      {
        id: 'peakJerk' as const,
        label: 'Peak Jerk',
        value: `${fmt(selectedPredictedRangeMetrics.peakJerkGPerSec)} g/s`,
      },
      {
        id: 'strikeDuration' as const,
        label: 'Strike Duration',
        value: `${selectedPredictedRangeMetrics.strikeDurationMs.toFixed(1)} ms`,
      },
      {
        id: 'preImpactDuration' as const,
        label: 'Pre-Impact Duration',
        value: `${selectedPredictedRangeMetrics.preImpactDurationMs.toFixed(1)} ms`,
      },
      {
        id: 'postImpactDuration' as const,
        label: 'Post-Impact Duration',
        value: `${selectedPredictedRangeMetrics.postImpactDurationMs.toFixed(1)} ms`,
      },
      {
        id: 'preImpactSpeedProxy' as const,
        label: 'Pre-Impact Speed Proxy',
        value: `${fmt(selectedPredictedRangeMetrics.preImpactSpeedProxyMps)} m/s`,
      },
    ]
  }, [selectedPredictedRangeMetrics])

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

  useEffect(() => {
    let cancelled = false

    hasStrikeModelArtifact().then((available) => {
      if (cancelled) return
      setIsStrikeModelAvailable(available)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!isStrikeModelAvailable || !points.length) {
      setStrikeInference(null)
      setModelStatus('idle')
      setModelError('')
      return () => {
        cancelled = true
      }
    }

    setStrikeInference(null)
    setModelStatus('loading')
    setModelError('')

    inferStrikeWindows(points)
      .then((result) => {
        if (cancelled) return
        setStrikeInference(result)
        setPredictionThresholdInput(result.defaultThreshold.toFixed(2))
        setModelStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setStrikeInference(null)
        setModelStatus('error')
        setModelError(err instanceof Error ? err.message : 'Failed to run strike model')
      })

    return () => {
      cancelled = true
    }
  }, [isStrikeModelAvailable, points])

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

  const selectAroundCursor = useCallback(() => {
    if (!points.length || cursorSelectionRadius === null) return

    const maxIndex = points.length - 1
    const center = clamp(playbackIndex, 0, maxIndex)
    const start = clamp(center - cursorSelectionRadius, 0, maxIndex)
    const end = clamp(center + cursorSelectionRadius, start, maxIndex)

    setSelection({ start, end })
    setSelectionAnchor(center)
    setIsSelecting(false)
  }, [cursorSelectionRadius, playbackIndex, points.length])

  const removeLabeledRange = useCallback((id: string) => {
    setLabeledRanges((prev) => prev.filter((range) => range.id !== id))
  }, [])

  const selectPredictedRange = useCallback(
    (range: PredictedStrikeRange) => {
      setPlaying(false)
      setPlaybackSource('selection')
      setPlaybackIndex(range.startIndex)
      setSelection({ start: range.startIndex, end: range.endIndex })
      setSelectionAnchor(null)
      setIsSelecting(false)
      setIsScrubbing(false)
    },
    [setPlaybackIndex],
  )

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
        setStrikeInference(null)
        setModelStatus('idle')
        setModelError('')
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
      setStrikeInference(null)
      setModelStatus(isStrikeModelAvailable ? 'loading' : 'idle')
      setModelError('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
      setPoints([])
      setLabeledRanges([])
      setStrikeInference(null)
      setModelStatus('idle')
      setModelError('')
    }
  }, [isStrikeModelAvailable])

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

              <div className="selectionToolsRow">
                <span>Select from cursor:</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={cursorSelectionRadiusInput}
                  onChange={(event) => setCursorSelectionRadiusInput(event.target.value)}
                  aria-label="Samples left and right from cursor"
                />
                <button onClick={selectAroundCursor} disabled={!canSelectAroundCursor}>
                  Select ±X Samples
                </button>
              </div>

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
                {shouldShowStrikeModel && (
                  <span>
                    Predicted Strikes: <b>{predictedRanges.length}</b>
                  </span>
                )}
              </div>
            </section>

            {shouldShowStrikeModel && (
              <section className="labelingCard">
                <div className="labelingHeader">
                  <button
                    className="collapseToggle"
                    onClick={() => setIsStrikeModelCollapsed((prev) => !prev)}
                    aria-expanded={!isStrikeModelCollapsed}
                    aria-label={`${isStrikeModelCollapsed ? 'Expand' : 'Collapse'} Strike Model`}
                  >
                    <span>{isStrikeModelCollapsed ? '▸' : '▾'}</span>
                    <span>Strike Model</span>
                  </button>
                  <span>{modelStatus === 'ready' ? `${predictedRanges.length.toLocaleString()} ranges` : modelStatus}</span>
                </div>
                {!isStrikeModelCollapsed && (
                  <div className="labelingBody">
                    <div className="modelStatusRow">
                      <span className={`statusBadge ${modelStatus}`}>
                        {modelStatus === 'idle' && 'Waiting for data'}
                        {modelStatus === 'loading' && 'Running inference'}
                        {modelStatus === 'ready' && 'Model ready'}
                      </span>
                      {strikeInference && (
                        <span className="modelMeta">
                          {strikeInference.modelVersion} · {strikeInference.windowSize}-sample windows · stride{' '}
                          {strikeInference.stride}
                        </span>
                      )}
                    </div>

                    <div className="labelingRow">
                      <label className="labeledInput">
                        <span>Threshold</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={predictionThresholdInput}
                          onChange={(event) => setPredictionThresholdInput(event.target.value)}
                          disabled={modelStatus !== 'ready'}
                        />
                      </label>
                      <label className="checkboxRow">
                        <input
                          type="checkbox"
                          checked={showModelPredictions}
                          onChange={(event) => setShowModelPredictions(event.target.checked)}
                        />
                        <span>Show predicted ranges on charts</span>
                      </label>
                    </div>

                    <p className="labelingHint">
                      {modelError
                        ? modelError
                        : strikeInference
                          ? `Scanned ${strikeInference.windowPredictions.length.toLocaleString()} windows. ${positivePredictionCount.toLocaleString()} windows are above threshold ${predictionThreshold.toFixed(
                              2,
                            )}, merged into ${predictedRanges.length.toLocaleString()} predicted strike ranges.`
                          : 'Load a sensor CSV to run the bundled strike detector.'}
                    </p>

                    {selectedPredictedRange && selectedPredictedRangeMetrics && (
                      <div className="metricsPanel">
                        <div className="labelingHeader">
                          <span>Selected Predicted Strike</span>
                          <span>
                            [{selectedPredictedRange.startIndex}-{selectedPredictedRange.endIndex}] max p=
                            {selectedPredictedRange.maxProbability.toFixed(2)}
                          </span>
                        </div>
                        <div className="metricsGrid">
                          {selectedPredictedMetricItems.map((metric) => (
                            <div key={metric.id} className="metricItem">
                              <div className="metricHeader">
                                <span>{metric.label}</span>
                                <button
                                  type="button"
                                  className="metricInfoButton"
                                  aria-label={`Explain ${metric.label}`}
                                  aria-expanded={openMetricInfo === metric.id}
                                  onClick={() =>
                                    setOpenMetricInfo((current) => (current === metric.id ? null : metric.id))
                                  }
                                >
                                  i
                                </button>
                              </div>
                              <strong>{metric.value}</strong>
                              {openMetricInfo === metric.id && (
                                <div className="metricInfoPopup" role="dialog" aria-label={`${metric.label} explanation`}>
                                  {STRIKE_METRIC_INFO[metric.id]}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!!predictedRanges.length && !selectedPredictedRange && (
                      <p className="labelingHint">Select a predicted strike below to make it the active range and inspect metrics.</p>
                    )}

                    {!!predictedRanges.length && (
                      <div className="rangeList">
                        {predictedRanges.map((range) => (
                          <button
                            key={range.id}
                            type="button"
                            className={`rangeListItem rangeListItemButton${
                              selectedPredictedRange?.id === range.id ? ' isActive' : ''
                            }`}
                            onClick={() => selectPredictedRange(range)}
                          >
                            <span className="rangeListCopy">
                              <b>{range.label}</b> [{range.startIndex}-{range.endIndex}] {fmt(range.startTimeSec)}s to{' '}
                              {fmt(range.endTimeSec)}s ({range.sampleCount.toLocaleString()} samples, max p=
                              {range.maxProbability.toFixed(2)})
                            </span>
                            <span className="rangeListAction">
                              {selectedPredictedRange?.id === range.id ? 'Selected' : 'Select'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

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
                      : 'Drag on any chart to select a range, drag the selected area to move it, or resize with edge handles.'}
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
                motionRanges={chartRanges}
                selectedStrikeOverlay={selectedStrikeOverlay}
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
