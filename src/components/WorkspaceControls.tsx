import { fmt, formatCsvClockTime, type Sample } from '../lib/sensor'
import type { Selection } from '../lib/playback'

type WorkspaceControlsProps = {
  labeledRangeCount: number
  onClearSelection: () => void
  onResetView: () => void
  onScrollWindowChange: (nextStart: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomToSelection: () => void
  points: Sample[]
  predictedRangeCount: number
  recordingFrequencyLabel: string
  selection: Selection
  shouldShowStrikeModel: boolean
  viewEnd: number
  viewSize: number
  viewStart: number
}

export function WorkspaceControls({
  labeledRangeCount,
  onClearSelection,
  onResetView,
  onScrollWindowChange,
  onZoomIn,
  onZoomOut,
  onZoomToSelection,
  points,
  predictedRangeCount,
  recordingFrequencyLabel,
  selection,
  shouldShowStrikeModel,
  viewEnd,
  viewSize,
  viewStart,
}: WorkspaceControlsProps) {
  return (
    <section className="controls">
      <div className="buttonRow">
        <button onClick={onZoomIn}>Zoom In</button>
        <button onClick={onZoomOut}>Zoom Out</button>
        <button onClick={onResetView}>Reset View</button>
        <button onClick={onZoomToSelection} disabled={!selection}>
          Zoom To Selection
        </button>
        <button onClick={onClearSelection} disabled={!selection}>
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
          onChange={(event) => onScrollWindowChange(Number(event.target.value))}
        />
      </label>

      <div className="metaRow">
        <span>
          Samples: <b>{points.length.toLocaleString()}</b> · Frequency: <b>{recordingFrequencyLabel}</b>
        </span>
        <span>
          Visible: <b>{(viewEnd - viewStart + 1).toLocaleString()}</b>
        </span>
        <span>
          Range: <b>{fmt(points[viewStart].t)}s</b> to <b>{fmt(points[viewEnd].t)}s</b>
        </span>
        <span>
          Clock: <b>{formatCsvClockTime(points[viewStart].timestamp)}</b> to <b>{formatCsvClockTime(points[viewEnd].timestamp)}</b>
        </span>
        {selection && (
          <span>
            Selected: <b>{(Math.abs(selection.end - selection.start) + 1).toLocaleString()}</b>
          </span>
        )}
        <span>
          Labeled Ranges: <b>{labeledRangeCount}</b>
        </span>
        {shouldShowStrikeModel && (
          <span>
            Predicted Strikes: <b>{predictedRangeCount}</b>
          </span>
        )}
      </div>
    </section>
  )
}
