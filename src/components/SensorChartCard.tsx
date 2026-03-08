import { useState } from 'react'
import { COLORS, clamp, sampleVisible, toPath } from '../lib/sensor'
import type { AxisKey, Sample } from '../lib/sensor'

type Selection = { start: number; end: number } | null

type SensorChartCardProps = {
  title: string
  keys: AxisKey[]
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
  setIsSelecting: (value: boolean) => void
  setSelectionAnchor: (value: number | null) => void
  setSelection: (value: Selection) => void
  setIsScrubbing: (value: boolean) => void
  setPlaying: (value: boolean) => void
  setPlaybackIndex: (value: number) => void
  zoom: (factor: number, anchorRatio: number) => void
  pan: (deltaSamples: number) => void
}

export function SensorChartCard({
  title,
  keys,
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
  setIsSelecting,
  setSelectionAnchor,
  setSelection,
  setIsScrubbing,
  setPlaying,
  setPlaybackIndex,
  zoom,
  pan,
}: SensorChartCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  const chartPointerToIndex = (clientX: number, target: SVGSVGElement | null) => {
    if (!target || !points.length) return null
    const bounds = target.getBoundingClientRect()
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    return Math.round(viewStart + ratio * (viewEnd - viewStart))
  }

  const updatePlaybackFromPointer = (clientX: number, target: SVGSVGElement | null) => {
    const index = chartPointerToIndex(clientX, target)
    if (index === null) return
    setPlaying(false)
    setPlaybackIndex(index)
  }

  const allSeries = collapsed ? [] : keys.map((key) => sampleVisible(points, key, viewStart, viewEnd, chartWidth))
  const yValues = allSeries.flatMap((series) => series.map((p) => p.v))
  const yMin = yValues.length ? Math.min(...yValues) : -1
  const yMax = yValues.length ? Math.max(...yValues) : 1
  const yPad = (yMax - yMin || 1) * 0.1
  const playheadX = collapsed
    ? 0
    : ((clamp(playbackIndex, viewStart, viewEnd) - viewStart) / Math.max(1, viewEnd - viewStart)) * chartWidth

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
          className="chart"
          width={chartWidth}
          height={200}
          onWheel={(e) => {
            e.preventDefault()
            const bounds = e.currentTarget.getBoundingClientRect()
            const ratio = clamp((e.clientX - bounds.left) / bounds.width, 0, 1)
            if (Math.abs(e.deltaY) < 4) return
            if (e.ctrlKey || e.metaKey) {
              zoom(e.deltaY > 0 ? 1.12 : 0.88, ratio)
            } else {
              pan(Math.round((e.deltaY / 100) * Math.max(4, viewSize * 0.05)))
            }
          }}
          onPointerDown={(e) => {
            const index = chartPointerToIndex(e.clientX, e.currentTarget)
            if (index === null) return
            setSelectionAnchor(index)
            setSelection({ start: index, end: index })
            setIsSelecting(true)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (isScrubbing) {
              updatePlaybackFromPointer(e.clientX, e.currentTarget)
              return
            }
            if (!isSelecting || selectionAnchor === null) return
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
          <rect x={0} y={0} width={chartWidth} height={200} className="chartBg" />

          {[0.25, 0.5, 0.75].map((v) => (
            <line key={v} x1={0} y1={200 * v} x2={chartWidth} y2={200 * v} className="gridLine" />
          ))}

          {keys.map((key, idx) => (
            <path
              key={key}
              d={toPath(allSeries[idx], viewStart, viewEnd, yMin - yPad, yMax + yPad, chartWidth, 200)}
              stroke={COLORS[key]}
              fill="none"
              strokeWidth={1.4}
            />
          ))}

          {selection && (
            <rect
              className="selection"
              x={
                ((Math.min(selection.start, selection.end) - viewStart) / Math.max(1, viewEnd - viewStart)) * chartWidth
              }
              y={0}
              width={(Math.abs(selection.end - selection.start) / Math.max(1, viewEnd - viewStart)) * chartWidth}
              height={200}
            />
          )}

          <line x1={playheadX} y1={0} x2={playheadX} y2={200} className="playheadLine" />
          <rect
            x={playheadX - 7}
            y={0}
            width={14}
            height={200}
            className="playheadHit"
            onPointerDown={(e) => {
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
