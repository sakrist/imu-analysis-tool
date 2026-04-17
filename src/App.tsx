import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AppToolbar } from './components/AppToolbar'
import { ManualLabelsPanel } from './components/ManualLabelsPanel'
import { PlaybackPanel } from './components/PlaybackPanel'
import { SensorChartCard } from './components/SensorChartCard'
import { StrikeModelPanel } from './components/StrikeModelPanel'
import { WorkspaceControls } from './components/WorkspaceControls'
import { useChartWidth } from './hooks/useChartWidth'
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys'
import { useObjectUrlFile } from './hooks/useObjectUrlFile'
import { useTimeBasedPlayback } from './hooks/useTimeBasedPlayback'
import { parseLabeledRangesCsv, serializeLabeledRangesCsv, sortLabeledRanges, type LabeledRange } from './lib/labels'
import { type PlaybackSource, normalizeSelection, resolvePlaybackWindow, type Selection } from './lib/playback'
import {
  buildPredictedRangeMetrics,
  buildSelectedPredictedMetricItems,
  filterPredictedRanges,
  getSelectedPeakSwingSpeedComparison,
  getSelectedPredictedConsistencyScore,
  MIN_AIR_STRIKE_PEAK_JERK_G_PER_SEC,
  MIN_PRE_IMPACT_HURLEY_HANDLE_SPEED_MPS,
  MIN_SWING_DURATION_TO_IMPACT_MS,
  STRIKE_METRIC_INFO,
} from './lib/strikeInsights'
import { CHART_GROUPS, clamp, computeTrajectory, parseCsv } from './lib/sensor'
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

  const modelPredictedRanges = useMemo(
    () =>
      strikeInference
        ? buildPredictedStrikeRanges(points, strikeInference.windowPredictions, predictionThreshold, strikeInference.stride)
        : [],
    [points, predictionThreshold, strikeInference],
  )
  const { predictedRanges, filteredPredictedRangeCount } = useMemo(
    () => filterPredictedRanges(points, modelPredictedRanges),
    [modelPredictedRanges, points],
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
  const recordingFrequencyHz = useMemo(() => {
    if (points.length < 2) return null

    const durationSeconds = points[points.length - 1].timestamp - points[0].timestamp
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null

    return (points.length - 1) / durationSeconds
  }, [points])
  const recordingFrequencyLabel =
    recordingFrequencyHz === null
      ? '-'
      : `${recordingFrequencyHz >= 10 ? recordingFrequencyHz.toFixed(1) : recordingFrequencyHz.toFixed(2)} Hz`
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
  const predictedRangeMetrics = useMemo(() => buildPredictedRangeMetrics(points, predictedRanges), [points, predictedRanges])
  const selectedStrikeOverlay = useMemo(
    () =>
      selectedPredictedRange && selectedPredictedRangeMetrics
        ? {
            strikeStartIndex: selectedPredictedRange.startIndex,
            impactIndex: selectedPredictedRangeMetrics.impactIndex,
            strikeEndIndex: selectedPredictedRangeMetrics.strikeEndIndex,
          }
        : null,
    [selectedPredictedRange, selectedPredictedRangeMetrics],
  )
  const selectedPredictedConsistencyScore = useMemo(
    () => getSelectedPredictedConsistencyScore(predictedRangeMetrics, selectedPredictedRange?.id ?? null),
    [predictedRangeMetrics, selectedPredictedRange],
  )
  const selectedPeakSwingSpeedComparison = useMemo(
    () => getSelectedPeakSwingSpeedComparison(predictedRangeMetrics, selectedPredictedRange?.id ?? null),
    [predictedRangeMetrics, selectedPredictedRange],
  )
  const selectedPredictedMetricItems = useMemo(
    () =>
      buildSelectedPredictedMetricItems(
        selectedPredictedRangeMetrics,
        selectedPeakSwingSpeedComparison,
        selectedPredictedConsistencyScore,
      ),
    [selectedPeakSwingSpeedComparison, selectedPredictedConsistencyScore, selectedPredictedRangeMetrics],
  )

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
      <AppToolbar
        audioFileAccept={AUDIO_FILE_ACCEPT}
        audioLoaded={Boolean(audioTrack)}
        onAudioFileChange={onAudioFileChange}
        onClearAudio={clearAudioTrack}
        onFileChange={onFileChange}
        onToggleHotkeys={() => setShowHotkeysPopover((prev) => !prev)}
        showHotkeysPopover={showHotkeysPopover}
      />

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
            <WorkspaceControls
              canSelectAroundCursor={canSelectAroundCursor}
              cursorSelectionRadiusInput={cursorSelectionRadiusInput}
              labeledRangeCount={labeledRanges.length}
              onClearSelection={clearSelectionState}
              onCursorSelectionRadiusInputChange={setCursorSelectionRadiusInput}
              onResetView={resetView}
              onScrollWindowChange={(nextStart) => {
                setViewStart(nextStart)
                setViewEnd(nextStart + viewSize)
              }}
              onSelectAroundCursor={selectAroundCursor}
              onZoomIn={() => zoom(0.75)}
              onZoomOut={() => zoom(1.35)}
              onZoomToSelection={zoomToSelection}
              points={points}
              predictedRangeCount={predictedRanges.length}
              recordingFrequencyLabel={recordingFrequencyLabel}
              selection={selection}
              shouldShowStrikeModel={shouldShowStrikeModel}
              viewEnd={viewEnd}
              viewSize={viewSize}
              viewStart={viewStart}
            />

            {shouldShowStrikeModel && (
              <StrikeModelPanel
                filteredPredictedRangeCount={filteredPredictedRangeCount}
                isCollapsed={isStrikeModelCollapsed}
                minPeakJerkGPerSec={MIN_AIR_STRIKE_PEAK_JERK_G_PER_SEC}
                minPreImpactHurleyHandleSpeedMps={MIN_PRE_IMPACT_HURLEY_HANDLE_SPEED_MPS}
                minSwingDurationToImpactMs={MIN_SWING_DURATION_TO_IMPACT_MS}
                modelError={modelError}
                modelPredictedRangesCount={modelPredictedRanges.length}
                modelStatus={modelStatus}
                onPredictionThresholdInputChange={setPredictionThresholdInput}
                onSelectPredictedRange={selectPredictedRange}
                onToggleCollapsed={() => setIsStrikeModelCollapsed((prev) => !prev)}
                onToggleMetricInfo={(metricId) =>
                  setOpenMetricInfo((current) => (current === metricId ? null : metricId))
                }
                onToggleShowModelPredictions={setShowModelPredictions}
                openMetricInfo={openMetricInfo}
                positivePredictionCount={positivePredictionCount}
                predictedRanges={predictedRanges}
                predictionThreshold={predictionThreshold}
                predictionThresholdInput={predictionThresholdInput}
                selectedPredictedMetricItems={selectedPredictedMetricItems}
                selectedPredictedRange={selectedPredictedRange}
                selectedPredictedRangeMetrics={selectedPredictedRangeMetrics}
                showModelPredictions={showModelPredictions}
                strikeInference={strikeInference}
                strikeMetricInfo={STRIKE_METRIC_INFO}
              />
            )}

            <ManualLabelsPanel
              canAddLabeledRange={canAddLabeledRange}
              isCollapsed={isLabelingCollapsed}
              labeledRanges={labeledRanges}
              onAddSelectedRange={addLabeledRange}
              onClearLabels={() => setLabeledRanges([])}
              onExportLabels={exportLabeledRanges}
              onLabelsFileChange={onLabelsFileChange}
              onRangeLabelInputChange={setRangeLabelInput}
              onRemoveLabeledRange={removeLabeledRange}
              onToggleCollapsed={() => setIsLabelingCollapsed((prev) => !prev)}
              points={points}
              rangeLabelInput={rangeLabelInput}
              selectedRangeBounds={selectedRangeBounds}
              selectedSampleCount={selectedSampleCount}
            />

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
