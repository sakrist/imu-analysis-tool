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

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Handler to match React's onWheel logic
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      svg.removeEventListener('wheel', handleWheel)
    }
  }, [])

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
            // All logic as before, but e.preventDefault() is guaranteed by native listener
            const bounds = e.currentTarget.getBoundingClientRect()
            const ratio = clamp((e.clientX - bounds.left - PLOT_LEFT) / plotWidth, 0, 1)

            // Option (Alt) + wheel scrolls (pans) the graph horizontally
            if (e.altKey) {
              if (Math.abs(e.deltaY) < 4) return
              pan(Math.round((e.deltaY / 100) * Math.max(4, viewSize * 0.05)))
              return
            }

            if (e.ctrlKey || e.metaKey) {
              if (Math.abs(e.deltaY) < 4) return
              zoom(e.deltaY > 0 ? 1.12 : 0.88, ratio)
              return
            }

            const horizontalDelta = e.shiftKey ? e.deltaY : e.deltaX
            if (Math.abs(horizontalDelta) < 4) return
            pan(Math.round((horizontalDelta / 100) * Math.max(4, viewSize * 0.05)))
          }}
          onDoubleClick={(e) => {
            // Jump playback cursor to double-clicked position and clear selection state
            updatePlaybackFromPointer(e.clientX, e.currentTarget)
            clearSelectionState()
          }}
          onPointerDown={(e) => {
            e.preventDefault()
            const index = chartPointerToIndex(e.clientX, e.currentTarget)
            if (index === null) return
            setSelectionAnchor(index)
            setSelection({ start: index, end: index })
            setIsSelecting(true)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (isScrubbing) {
              e.preventDefault()
              updatePlaybackFromPointer(e.clientX, e.currentTarget)
              return
            }
            if (!isSelecting || selectionAnchor === null) return
            e.preventDefault()
            const index = chartPointerToIndex(e.clientX, e.currentTarget)
            if (index === null) return
            setSelection({ start: selectionAnchor, end: index })
          }}
          onPointerUp={(e) => {
            if (isScrubbing) {
              setIsScrubbing(false)
              e.currentTarget.releasePointerCapture(e.pointerId)
              return
            }
            if (!isSelecting) return
            setIsSelecting(false)
            e.currentTarget.releasePointerCapture(e.pointerId)
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

          {selection && (
            <rect
              className="selection"
              x={PLOT_LEFT + indexToPlotX(Math.min(selection.start, selection.end))}
              y={PLOT_TOP}
              width={Math.max(sampleWidthPx, (Math.abs(selection.end - selection.start) / xRange) * plotWidth)}
              height={PLOT_HEIGHT}
            />
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
