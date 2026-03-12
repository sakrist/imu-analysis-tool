import { useEffect, useMemo, useRef, useState } from 'react'
import { PlaybackPanel } from './components/PlaybackPanel'
import { SensorChartCard } from './components/SensorChartCard'
import { CHART_GROUPS, clamp, computeTrajectory, fmt, parseCsv } from './lib/sensor'
import { parseLabeledRangesCsv, sortLabeledRanges, type LabeledRange } from './lib/labels'
import type { Sample } from './lib/sensor'
import './App.css'

function App() {
  const [points, setPoints] = useState<Sample[]>([])
  const [error, setError] = useState('')
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [chartWidth, setChartWidth] = useState(1000)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackSource, setPlaybackSource] = useState<'view' | 'selection'>('view')
  const [labeledRanges, setLabeledRanges] = useState<LabeledRange[]>([])
  const [rangeLabelInput, setRangeLabelInput] = useState('')
  const [sourceFileName, setSourceFileName] = useState('motion')

  const chartRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = chartRef.current
    if (!el) return

    const resizeObserver = new ResizeObserver(() => {
      setChartWidth(Math.max(320, el.clientWidth - 24))
    })
    resizeObserver.observe(el)
    setChartWidth(Math.max(320, el.clientWidth - 24))

    return () => resizeObserver.disconnect()
  }, [points.length])

  const viewSize = Math.max(1, viewEnd - viewStart)

  const playbackWindow = useMemo(() => {
    if (!points.length) return null
    if (playbackSource === 'selection' && selection) {
      return {
        start: Math.min(selection.start, selection.end),
        end: Math.max(selection.start, selection.end),
      }
    }
    return { start: viewStart, end: viewEnd }
  }, [playbackSource, points.length, selection, viewStart, viewEnd])

  const currentPoint = points[clamp(playbackIndex, 0, points.length - 1)]
  const playbackSamples = useMemo(() => {
    if (!playbackWindow) return [] as Sample[]
    return points.slice(playbackWindow.start, playbackWindow.end + 1)
  }, [playbackWindow, points])

  const trajectory = useMemo(() => {
    if (!playbackWindow) return []
    return computeTrajectory(points, playbackWindow.start, playbackWindow.end)
  }, [playbackWindow, points])

  const selectedRangeBounds = useMemo(() => {
    if (!selection) return null
    return {
      start: Math.min(selection.start, selection.end),
      end: Math.max(selection.start, selection.end),
    }
  }, [selection])

  const currentTrajectoryPoint = useMemo(() => {
    if (!playbackWindow || !trajectory.length) return null
    const idx = clamp(playbackIndex - playbackWindow.start, 0, trajectory.length - 1)
    return trajectory[idx]
  }, [playbackIndex, playbackWindow, trajectory])
  const selectedSampleCount = selectedRangeBounds
    ? Math.abs(selectedRangeBounds.end - selectedRangeBounds.start) + 1
    : 0
  const canAddLabeledRange = Boolean(points.length && selectedRangeBounds && rangeLabelInput.trim())

  useEffect(() => {
    if (!playbackWindow || !points.length || !playing) return

    const timer = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev < playbackWindow.start || prev > playbackWindow.end) return playbackWindow.start
        const next = prev + 1
        if (next > playbackWindow.end) {
          setPlaying(false)
          return playbackWindow.end
        }
        return next
      })
    }, 33)

    return () => clearInterval(timer)
  }, [playbackWindow, playing, points.length])

  const zoom = (factor: number, anchorRatio = 0.5) => {
    if (!points.length) return
    const fullRange = points.length - 1
    const oldSize = Math.max(8, viewEnd - viewStart)
    const nextSize = clamp(Math.round(oldSize * factor), 8, fullRange)
    const anchor = viewStart + oldSize * anchorRatio
    const nextStart = clamp(Math.round(anchor - nextSize * anchorRatio), 0, fullRange - nextSize)
    setViewStart(nextStart)
    setViewEnd(nextStart + nextSize)
  }

  const pan = (deltaSamples: number) => {
    if (!points.length) return
    const fullRange = points.length - 1
    const windowSize = viewEnd - viewStart
    const nextStart = clamp(viewStart + deltaSamples, 0, fullRange - windowSize)
    setViewStart(nextStart)
    setViewEnd(nextStart + windowSize)
  }

  const addLabeledRange = () => {
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
  }

  const removeLabeledRange = (id: string) => {
    setLabeledRanges((prev) => prev.filter((range) => range.id !== id))
  }

  const exportLabeledRanges = () => {
    if (!labeledRanges.length) return

    const escapeCsv = (value: string | number) => {
      const text = String(value)
      if (!/[",\n]/.test(text)) return text
      return `"${text.replace(/"/g, '""')}"`
    }

    const header = [
      'label',
      'startIndex',
      'endIndex',
      'startTimeSec',
      'endTimeSec',
      'durationSec',
      'sampleCount',
    ]
    const rows = sortLabeledRanges(labeledRanges).map((range) =>
      [
        range.label,
        range.startIndex,
        range.endIndex,
        range.startTimeSec.toFixed(6),
        range.endTimeSec.toFixed(6),
        range.durationSec.toFixed(6),
        range.sampleCount,
      ]
        .map(escapeCsv)
        .join(','),
    )

    const csv = [header.join(','), ...rows].join('\n')
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
  }

  const onLabelsFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  }

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div>
          <h1>Motion CSV Analyzer</h1>
          <p>timestamp + accel + gyro + gravity with zoom, pan, selection, and playback.</p>
        </div>
        <label className="fileInput">
          <span>Load CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
        </label>
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
            />
          </div>

          <div className="workspaceRight" ref={chartRef}>
            <section className="controls">
              <div className="buttonRow">
                <button onClick={() => zoom(0.75)}>Zoom In</button>
                <button onClick={() => zoom(1.35)}>Zoom Out</button>
                <button
                  onClick={() => {
                    setViewStart(0)
                    setViewEnd(points.length - 1)
                  }}
                >
                  Reset View
                </button>
                <button
                  onClick={() => {
                    if (!selection) return
                    const start = Math.min(selection.start, selection.end)
                    const end = Math.max(selection.start, selection.end)
                    if (end > start) {
                      setViewStart(start)
                      setViewEnd(end)
                    }
                  }}
                  disabled={!selection}
                >
                  Zoom To Selection
                </button>
                <button onClick={() => setSelection(null)} disabled={!selection}>
                  Clear Selection
                </button>
              </div>

              <section className="labelingPanel">
                <div className="labelingHeader">
                  <b>Manual Labels</b>
                  <span>{labeledRanges.length.toLocaleString()} saved</span>
                </div>
                <div className="labelingRow">
                  <input
                    value={rangeLabelInput}
                    onChange={(e) => setRangeLabelInput(e.target.value)}
                    placeholder="Label name (e.g. run, swing, walk)"
                  />
                  <label className="inlineFileInput">
                    <span>Load Labels CSV</span>
                    <input type="file" accept=".csv,text/csv" onChange={onLabelsFileChange} />
                  </label>
                  <button onClick={addLabeledRange} disabled={!canAddLabeledRange}>
                    Add Selected Range
                  </button>
                  <button onClick={exportLabeledRanges} disabled={!labeledRanges.length}>
                    Export Labels CSV
                  </button>
                  <button onClick={() => setLabeledRanges([])} disabled={!labeledRanges.length}>
                    Clear Labels
                  </button>
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
              </section>

              <label className="scrollRow">
                <span>Scroll window</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, points.length - 1 - viewSize)}
                  value={Math.min(viewStart, Math.max(0, points.length - 1 - viewSize))}
                  onChange={(e) => {
                    const nextStart = Number(e.target.value)
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

            {CHART_GROUPS.map((group) => (
              <SensorChartCard
                key={group.title}
                title={group.title}
                keys={group.keys}
                unit={group.unit}
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
