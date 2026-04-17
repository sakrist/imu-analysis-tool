import type { ChangeEventHandler } from 'react'
import { fmt, type Sample } from '../lib/sensor'
import type { LabeledRange } from '../lib/labels'

type ManualLabelsPanelProps = {
  canAddLabeledRange: boolean
  isCollapsed: boolean
  labeledRanges: LabeledRange[]
  onAddSelectedRange: () => void
  onClearLabels: () => void
  onExportLabels: () => void
  onLabelsFileChange: ChangeEventHandler<HTMLInputElement>
  onRangeLabelInputChange: (value: string) => void
  onRemoveLabeledRange: (id: string) => void
  onToggleCollapsed: () => void
  points: Sample[]
  rangeLabelInput: string
  selectedRangeBounds: { start: number; end: number } | null
  selectedSampleCount: number
}

export function ManualLabelsPanel({
  canAddLabeledRange,
  isCollapsed,
  labeledRanges,
  onAddSelectedRange,
  onClearLabels,
  onExportLabels,
  onLabelsFileChange,
  onRangeLabelInputChange,
  onRemoveLabeledRange,
  onToggleCollapsed,
  points,
  rangeLabelInput,
  selectedRangeBounds,
  selectedSampleCount,
}: ManualLabelsPanelProps) {
  return (
    <section className="labelingCard">
      <div className="labelingHeader">
        <button
          className="collapseToggle"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} Manual Labels`}
        >
          <span>{isCollapsed ? '▸' : '▾'}</span>
          <span>Manual Labels</span>
        </button>
        <span>{labeledRanges.length.toLocaleString()} saved</span>
      </div>
      {!isCollapsed && (
        <div className="labelingBody">
          <div className="labelingRow">
            <input
              value={rangeLabelInput}
              onChange={(event) => onRangeLabelInputChange(event.target.value)}
              placeholder="Label name (e.g. run, swing, walk)"
            />
            <button onClick={onAddSelectedRange} disabled={!canAddLabeledRange}>
              Add Selected Range
            </button>
            <button onClick={onClearLabels} disabled={!labeledRanges.length}>
              Clear Labels
            </button>
            <button onClick={onExportLabels} disabled={!labeledRanges.length}>
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
                  <button onClick={() => onRemoveLabeledRange(range.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
