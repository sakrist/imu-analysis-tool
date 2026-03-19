import { useState, useRef, useEffect } from 'react'
import { rangeColors } from '../lib/labels'
import type { Selection } from '../lib/playback'
import { COLORS, clamp, sampleVisible, toPath } from '../lib/sensor'
import type { AxisKey, Sample } from '../lib/sensor'
import type { LabeledRange } from '../lib/labels'

const PLOT_LEFT = 56
const PLOT_RIGHT = 10
const PLOT_TOP = 10
const PLOT_HEIGHT = 182
const PLOT_BOTTOM = 28
const SVG_HEIGHT = PLOT_TOP + PLOT_HEIGHT + PLOT_BOTTOM

const AXIS_TICK_RATIOS = [0, 0.25, 0.5, 0.75, 1]

type SelectionDragMode = 'create' | 'move' | 'resize-start' | 'resize-end'

function formatScaleValue(value: number) {
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(1)
  if (abs >= 10) return value.toFixed(2)
  if (abs >= 1) return value.toFixed(3)
  return value.toFixed(4)
}

type SensorChartCardProps = {
  title: string
  keys: AxisKey[]
  unit: string
  fixedYDomain?: [number, number]
  points: Sample[]
  chartWidth: number
  viewStart: number
  viewEnd: number
  viewSize: number
  selection: Selection
  selectionAnchor: number | null
  isSelecting: boolean
  isScrubbing: boolean
  playbackIndex: number
  motionRanges: LabeledRange[]
  setIsSelecting: (value: boolean) => void
  setSelectionAnchor: (value: number | null) => void
  setSelection: (value: Selection) => void
  setIsScrubbing: (value: boolean) => void
  setPlaying: (value: boolean) => void
  setPlaybackIndex: (value: number) => void
  zoom: (factor: number, anchorRatio: number) => void
  pan: (deltaSamples: number) => void
  clearSelectionState: () => void
}

export function SensorChartCard({
  title,
  keys,
  unit,
  fixedYDomain,
  points,
  chartWidth,
  viewStart,
  viewEnd,
  viewSize,
  selection,
  selectionAnchor,
  isSelecting,
  isScrubbing,
  playbackIndex,
  motionRanges,
  setIsSelecting,
  setSelectionAnchor,
  setSelection,
  setIsScrubbing,
  setPlaying,
  setPlaybackIndex,
  zoom,
  pan,
  clearSelectionState,
}: SensorChartCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [selectionDragMode, setSelectionDragMode] = useState<SelectionDragMode | null>(null)

  const plotWidth = Math.max(140, chartWidth - PLOT_LEFT - PLOT_RIGHT)
  const xRange = Math.max(1, viewEnd - viewStart)
  const sampleWidthPx = plotWidth / xRange

  const indexToPlotX = (index: number) => ((index - viewStart) / xRange) * plotWidth

  const chartPointerToIndex = (clientX: number, target: SVGSVGElement | null) => {
    if (!target || !points.length) return null
    const bounds = target.getBoundingClientRect()
    const ratio = clamp((clientX - bounds.left - PLOT_LEFT) / plotWidth, 0, 1)
    return Math.round(viewStart + ratio * xRange)
  }

  const updatePlaybackFromPointer = (clientX: number, target: SVGSVGElement | null) => {
    const index = chartPointerToIndex(clientX, target)
    if (index === null) return
    setPlaying(false)
    setPlaybackIndex(index)
  }

  const allSeries = collapsed ? [] : keys.map((key) => sampleVisible(points, key, viewStart, viewEnd, plotWidth))
  const yValues = allSeries.flatMap((series) => series.map((p) => p.v))
  const yMin = yValues.length ? Math.min(...yValues) : -1
  const yMax = yValues.length ? Math.max(...yValues) : 1
  const yPad = (yMax - yMin || 1) * 0.1
  const yStart = fixedYDomain ? Math.min(fixedYDomain[0], fixedYDomain[1]) : yMin - yPad
  const yEnd = fixedYDomain ? Math.max(fixedYDomain[0], fixedYDomain[1]) : yMax + yPad
  const yRange = Math.max(1e-9, yEnd - yStart)

  const playheadX = collapsed ? 0 : PLOT_LEFT + indexToPlotX(clamp(playbackIndex, viewStart, viewEnd))
  const visibleMotionRanges = collapsed
    ? []
    : motionRanges.filter((range) => range.endIndex >= viewStart && range.startIndex <= viewEnd)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const isHoveredRef = useRef(false)
  const hoverRatioRef = useRef(0.5)
  const selectionDragModeRef = useRef<SelectionDragMode | null>(null)
  const selectionDragStartRef = useRef<{ pointerIndex: number; start: number; end: number } | null>(null)

  const selectionBounds = selection
    ? {
        start: Math.min(selection.start, selection.end),
        end: Math.max(selection.start, selection.end),
      }
    : null
  const selectionX = selectionBounds ? PLOT_LEFT + indexToPlotX(selectionBounds.start) : 0
  const selectionWidth = selectionBounds
    ? Math.max(sampleWidthPx, (Math.abs(selectionBounds.end - selectionBounds.start) / xRange) * plotWidth)
    : 0
  const selectionHandleWidth = Math.min(10, Math.max(6, sampleWidthPx * 1.25))
  const leftSelectionHandleX = selectionX - selectionHandleWidth / 2
  const rightSelectionHandleX = selectionX + selectionWidth - selectionHandleWidth / 2

  const beginSelectionDrag = (
    mode: SelectionDragMode,
    pointerIndex: number,
    pointerId: number,
    svgTarget: SVGSVGElement | null,
  ) => {
    if (!points.length) return

    if (mode === 'create') {
      selectionDragModeRef.current = mode
      setSelectionDragMode(mode)
      selectionDragStartRef.current = {
        pointerIndex,
        start: pointerIndex,
        end: pointerIndex,
      }
      setSelectionAnchor(pointerIndex)
      setSelection({ start: pointerIndex, end: pointerIndex })
      setIsSelecting(true)
      svgTarget?.setPointerCapture(pointerId)
      return
    }

    if (!selectionBounds) return

    selectionDragModeRef.current = mode
    setSelectionDragMode(mode)
    selectionDragStartRef.current = {
      pointerIndex,
      start: selectionBounds.start,
      end: selectionBounds.end,
    }
    setSelectionAnchor(null)
    setIsSelecting(true)
    svgTarget?.setPointerCapture(pointerId)
  }

  const endSelectionDrag = () => {
    selectionDragModeRef.current = null
    selectionDragStartRef.current = null
    setSelectionDragMode(null)
    setSelectionAnchor(null)
    setIsSelecting(false)
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Handler to match React's onWheel logic
    const handleWheel = (e: WheelEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault()
      }
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      svg.removeEventListener('wheel', handleWheel)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isHoveredRef.current || collapsed) return
      if (!event.metaKey || event.ctrlKey || event.altKey) return

      const isZoomInKey =
        event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd'
      const isZoomOutKey =
        event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract'

      if (!isZoomInKey && !isZoomOutKey) return

      event.preventDefault()
      const anchorRatio = clamp(hoverRatioRef.current, 0, 1)
      zoom(isZoomInKey ? 0.88 : 1.12, anchorRatio)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [collapsed, zoom])

  return (
    <section className="chartCard">
      <div className="cardHeader">
        <div className="cardTitleRow">
          <button
            className="collapseToggle"
            onClick={() => {
              setCollapsed((prev) => !prev)
              setIsSelecting(false)
              setIsScrubbing(false)
              setSelectionAnchor(null)
              selectionDragModeRef.current = null
              selectionDragStartRef.current = null
              setSelectionDragMode(null)
              isHoveredRef.current = false
            }}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
          >
            <span>{collapsed ? '▸' : '▾'}</span>
            <span>{title}</span>
          </button>
        </div>
        <div className="legend">
          {keys.map((key) => (
            <span key={key}>
              <i style={{ background: COLORS[key] }} />
              {key}
            </span>
          ))}
        </div>
      </div>

      {!collapsed && (
        <svg
          ref={svgRef}
          className="chart"
          width={chartWidth}
          height={SVG_HEIGHT}
          onWheel={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect()
            const ratio = clamp((e.clientX - bounds.left - PLOT_LEFT) / plotWidth, 0, 1)
            hoverRatioRef.current = ratio

            // Ctrl/Cmd + wheel zooms chart.
            if (e.ctrlKey || e.metaKey) {
              if (Math.abs(e.deltaY) < 4) return
              zoom(e.deltaY > 0 ? 1.12 : 0.88, ratio)
              return
            }

            // Alt + wheel pans chart. Plain wheel should bubble to page scroll.
            if (!e.altKey) return
            const panDelta = e.deltaY
            if (Math.abs(panDelta) < 4) return
            pan(Math.round((panDelta / 100) * Math.max(4, viewSize * 0.05)))
          }}
          onDoubleClick={(e) => {
            // Jump playback cursor to double-clicked position and clear selection state
            updatePlaybackFromPointer(e.clientX, e.currentTarget)
            clearSelectionState()
          }}
          onPointerDown={(e) => {
            // If shift is held, start scrub mode directly on pointer down
            if (e.shiftKey) {
              e.preventDefault()
              e.stopPropagation()
              setPlaying(false)
              setIsScrubbing(true)
              updatePlaybackFromPointer(e.clientX, e.currentTarget)
              e.currentTarget.setPointerCapture(e.pointerId)
              return
            }
            e.preventDefault()
            const index = chartPointerToIndex(e.clientX, e.currentTarget)
            if (index === null) return
            beginSelectionDrag('create', index, e.pointerId, e.currentTarget)
          }}
          onPointerMove={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect()
            hoverRatioRef.current = clamp((e.clientX - bounds.left - PLOT_LEFT) / plotWidth, 0, 1)

            if (isScrubbing) {
              e.preventDefault()
              updatePlaybackFromPointer(e.clientX, e.currentTarget)
              return
            }
            if (!isSelecting) return
            e.preventDefault()
            const index = chartPointerToIndex(e.clientX, e.currentTarget)
            if (index === null) return
            const mode = selectionDragModeRef.current
            if (!mode) return

            if (mode === 'create') {
              const anchor = selectionAnchor ?? selectionDragStartRef.current?.pointerIndex
              if (anchor === undefined || anchor === null) return
              setSelection({ start: anchor, end: index })
              return
            }

            const dragStart = selectionDragStartRef.current
            if (!dragStart) return

            if (mode === 'resize-start') {
              setSelection({ start: index, end: dragStart.end })
              return
            }

            if (mode === 'resize-end') {
              setSelection({ start: dragStart.start, end: index })
              return
            }

            const selectionSpan = dragStart.end - dragStart.start
            const delta = index - dragStart.pointerIndex
            let nextStart = dragStart.start + delta
            let nextEnd = nextStart + selectionSpan
            const maxIndex = points.length - 1

            if (nextStart < 0) {
              nextEnd -= nextStart
              nextStart = 0
            }
            if (nextEnd > maxIndex) {
              const overflow = nextEnd - maxIndex
              nextStart -= overflow
              nextEnd = maxIndex
            }

            nextStart = clamp(nextStart, 0, maxIndex)
            nextEnd = clamp(nextEnd, nextStart, maxIndex)
            setSelection({ start: nextStart, end: nextEnd })
          }}
          onPointerUp={(e) => {
            if (isScrubbing) {
              setIsScrubbing(false)
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
              }
              return
            }
            if (!isSelecting) return
            endSelectionDrag()
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onPointerCancel={(e) => {
            if (isScrubbing) {
              setIsScrubbing(false)
            }
            if (isSelecting) {
              endSelectionDrag()
            }
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onPointerEnter={(e) => {
            isHoveredRef.current = true
            const bounds = e.currentTarget.getBoundingClientRect()
            hoverRatioRef.current = clamp((e.clientX - bounds.left - PLOT_LEFT) / plotWidth, 0, 1)
          }}
          onPointerLeave={() => {
            isHoveredRef.current = false
          }}
        >
          <rect x={PLOT_LEFT} y={PLOT_TOP} width={plotWidth} height={PLOT_HEIGHT} className="chartBg" />

          <line
            x1={PLOT_LEFT}
            y1={PLOT_TOP}
            x2={PLOT_LEFT}
            y2={PLOT_TOP + PLOT_HEIGHT}
            className="axisLine"
          />
          <line
            x1={PLOT_LEFT}
            y1={PLOT_TOP + PLOT_HEIGHT}
            x2={PLOT_LEFT + plotWidth}
            y2={PLOT_TOP + PLOT_HEIGHT}
            className="axisLine"
          />

          {AXIS_TICK_RATIOS.map((ratio) => {
            const y = PLOT_TOP + ratio * PLOT_HEIGHT
            const value = yEnd - ratio * yRange
            return (
              <g key={`y-${ratio}`}>
                {ratio > 0 && ratio < 1 && (
                  <line x1={PLOT_LEFT} y1={y} x2={PLOT_LEFT + plotWidth} y2={y} className="gridLine" />
                )}
                <line x1={PLOT_LEFT - 4} y1={y} x2={PLOT_LEFT} y2={y} className="axisTick" />
                <text x={PLOT_LEFT - 8} y={y + 4} textAnchor="end" className="axisText">
                  {formatScaleValue(value)}
                </text>
              </g>
            )
          })}

          {AXIS_TICK_RATIOS.map((ratio) => {
            const x = PLOT_LEFT + ratio * plotWidth
            const index = Math.round(viewStart + ratio * xRange)
            const timeValue = points[index]?.t ?? 0
            return (
              <g key={`x-${ratio}`}>
                <line x1={x} y1={PLOT_TOP + PLOT_HEIGHT} x2={x} y2={PLOT_TOP + PLOT_HEIGHT + 4} className="axisTick" />
                <text x={x} y={PLOT_TOP + PLOT_HEIGHT + 16} textAnchor="middle" className="axisText">
                  {timeValue.toFixed(2)}
                </text>
              </g>
            )
          })}

          <text x={PLOT_LEFT + 2} y={PLOT_TOP - 2} className="axisUnit">
            {unit}
          </text>
          <text x={PLOT_LEFT + plotWidth} y={PLOT_TOP + PLOT_HEIGHT + 26} textAnchor="end" className="axisUnit">
            time (s)
          </text>

          {visibleMotionRanges.map((range) => {
            const start = clamp(range.startIndex, viewStart, viewEnd)
            const end = clamp(range.endIndex, viewStart, viewEnd)
            const x = PLOT_LEFT + indexToPlotX(Math.min(start, end))
            const width = Math.max(sampleWidthPx, (Math.abs(end - start) / xRange) * plotWidth)
            const mid = x + width / 2
            const colors = rangeColors(range.label)

            return (
              <g key={range.id} className="motionRangeGroup">
                <rect
                  x={x}
                  y={PLOT_TOP}
                  width={width}
                  height={PLOT_HEIGHT}
                  style={{
                    fill: colors.fill,
                    stroke: colors.border,
                  }}
                  className="motionRange"
                />
                {width > 64 && (
                  <text x={mid} y={PLOT_TOP + 14} textAnchor="middle" className="motionRangeLabel">
                    {range.label}
                  </text>
                )}
              </g>
            )
          })}

          {keys.map((key, idx) => (
            <path
              key={key}
              d={toPath(allSeries[idx], viewStart, viewEnd, yStart, yEnd, plotWidth, PLOT_HEIGHT)}
              transform={`translate(${PLOT_LEFT} ${PLOT_TOP})`}
              stroke={COLORS[key]}
              fill="none"
              strokeWidth={1.4}
            />
          ))}

          {selectionBounds && (
            <g>
              <rect
                className={`selectionFill${selectionDragMode === 'move' ? ' isDragging' : ''}`}
                x={selectionX}
                y={PLOT_TOP}
                width={selectionWidth}
                height={PLOT_HEIGHT}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const svgTarget = e.currentTarget.ownerSVGElement
                  const index = chartPointerToIndex(e.clientX, svgTarget)
                  if (index === null) return
                  beginSelectionDrag('move', index, e.pointerId, svgTarget)
                }}
              />
              <rect
                className="selectionHandle"
                x={leftSelectionHandleX}
                y={PLOT_TOP}
                width={selectionHandleWidth}
                height={PLOT_HEIGHT}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const svgTarget = e.currentTarget.ownerSVGElement
                  const index = chartPointerToIndex(e.clientX, svgTarget)
                  if (index === null) return
                  beginSelectionDrag('resize-start', index, e.pointerId, svgTarget)
                }}
              />
              <rect
                className="selectionHandle"
                x={rightSelectionHandleX}
                y={PLOT_TOP}
                width={selectionHandleWidth}
                height={PLOT_HEIGHT}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const svgTarget = e.currentTarget.ownerSVGElement
                  const index = chartPointerToIndex(e.clientX, svgTarget)
                  if (index === null) return
                  beginSelectionDrag('resize-end', index, e.pointerId, svgTarget)
                }}
              />
            </g>
          )}

          <line x1={playheadX} y1={PLOT_TOP} x2={playheadX} y2={PLOT_TOP + PLOT_HEIGHT} className="playheadLine" />
          <rect
            x={playheadX - 7}
            y={PLOT_TOP}
            width={14}
            height={PLOT_HEIGHT}
            className="playheadHit"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setPlaying(false)
              setIsScrubbing(true)
              updatePlaybackFromPointer(e.clientX, e.currentTarget.ownerSVGElement)
              if (e.currentTarget.ownerSVGElement) {
                e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId)
              }
            }}
          />
        </svg>
      )}
    </section>
  )
}
