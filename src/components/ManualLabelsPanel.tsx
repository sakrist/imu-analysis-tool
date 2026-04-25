import { Fragment, type ChangeEventHandler } from 'react'
import type { SelectedPredictedMetricItem, StrikeMetricInfoKey } from '../lib/strikeInsights'
import type { StrikeWindowMetrics } from '../lib/strikeMetrics'
import { fmt, type Sample } from '../lib/sensor'
import type { LabeledRange } from '../lib/labels'

type ManualLabelsPanelProps = {
  canAddLabeledRange: boolean
  canSelectAroundCursor: boolean
  isCollapsed: boolean
  labeledRanges: LabeledRange[]
  onAddSelectedRange: () => void
  onAnalyzeLabeledRange: (range: LabeledRange) => void
  onClearLabels: () => void
  onCursorSelectionRadiusInputChange: (value: string) => void
  onExportLabels: () => void
  onLabelsFileChange: ChangeEventHandler<HTMLInputElement>
  onRangeLabelInputChange: (value: string) => void
  onRemoveLabeledRange: (id: string) => void
  onSelectAroundCursor: () => void
  onToggleMetricInfo: (metricId: StrikeMetricInfoKey) => void
  onToggleCollapsed: () => void
  openMetricInfo: StrikeMetricInfoKey | null
  points: Sample[]
  cursorSelectionRadiusInput: string
  rangeLabelInput: string
  selectedLabeledMetricItems: SelectedPredictedMetricItem[]
  selectedLabeledRange: LabeledRange | null
  selectedLabeledRangeMetrics: StrikeWindowMetrics | null
  selectedRangeBounds: { start: number; end: number } | null
  selectedSampleCount: number
  strikeMetricInfo: Record<StrikeMetricInfoKey, string>
}

export function ManualLabelsPanel({
  canAddLabeledRange,
  canSelectAroundCursor,
  cursorSelectionRadiusInput,
  isCollapsed,
  labeledRanges,
  onAddSelectedRange,
  onAnalyzeLabeledRange,
  onClearLabels,
  onCursorSelectionRadiusInputChange,
  onExportLabels,
  onLabelsFileChange,
  onRangeLabelInputChange,
  onRemoveLabeledRange,
  onSelectAroundCursor,
  onToggleMetricInfo,
  onToggleCollapsed,
  openMetricInfo,
  points,
  rangeLabelInput,
  selectedLabeledMetricItems,
  selectedLabeledRange,
  selectedLabeledRangeMetrics,
  selectedRangeBounds,
  selectedSampleCount,
  strikeMetricInfo,
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
          <div className="selectionToolsRow">
            <span>Select from cursor:</span>
            <input
              type="number"
              min={0}
              step={1}
              value={cursorSelectionRadiusInput}
              onChange={(event) => onCursorSelectionRadiusInputChange(event.target.value)}
              aria-label="Samples left and right from cursor"
            />
            <button onClick={onSelectAroundCursor} disabled={!canSelectAroundCursor}>
              Select +/-X Samples
            </button>
          </div>
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
                  <span className="rangeListCopy">
                    <b>{range.label}</b> [{range.startIndex}-{range.endIndex}] {fmt(range.startTimeSec)}s to{' '}
                    {fmt(range.endTimeSec)}s ({range.sampleCount.toLocaleString()} samples)
                  </span>
                  <div className="rangeListActions">
                    <button
                      type="button"
                      className={`rangeActionButton rangeAnalyzeButton${
                        selectedLabeledRange?.id === range.id ? ' isActive' : ''
                      }`}
                      onClick={() => onAnalyzeLabeledRange(range)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="rangeActionIcon">
                        <path
                          fill="currentColor"
                          d="M11 4a7 7 0 1 0 4.43 12.42l3.58 3.58a1 1 0 0 0 1.42-1.42l-3.58-3.58A7 7 0 0 0 11 4Zm-5 7a5 5 0 1 1 10 0 5 5 0 0 1-10 0Zm2.5 1.5a1 1 0 0 1 1-1h3.8a1 1 0 1 1 0 2H9.5a1 1 0 0 1-1-1Zm0-3a1 1 0 0 1 1-1h1.8a1 1 0 1 1 0 2H9.5a1 1 0 0 1-1-1Z"
                        />
                      </svg>
                      <span>Analyse</span>
                    </button>
                    <button
                      type="button"
                      className="rangeActionButton rangeRemoveButton"
                      aria-label={`Remove ${range.label}`}
                      onClick={() => onRemoveLabeledRange(range.id)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="rangeActionIcon">
                        <path
                          fill="currentColor"
                          d="M9 3a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H9ZM5 6a1 1 0 0 0 0 2h.7l1.1 11.2A2 2 0 0 0 8.79 21h6.42a2 2 0 0 0 1.99-1.8L18.3 8H19a1 1 0 1 0 0-2H5Zm3.71 2 1 10h4.58l1-10H8.71Z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!!labeledRanges.length && !selectedLabeledRange && (
            <p className="labelingHint">Click Analyse on a labeled range to inspect swing metrics.</p>
          )}

          {selectedLabeledRange && selectedLabeledRangeMetrics && (
            <div className="metricsTableWrap">
              <table className="metricsTable">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="metricNameCell">
                      <span className="metricNameText">Selected Labeled Range</span>
                    </th>
                    <td className="metricValueCell">
                      {selectedLabeledRange.label} [{selectedLabeledRange.startIndex}-{selectedLabeledRange.endIndex}]
                    </td>
                  </tr>
                  {selectedLabeledMetricItems.map((metric) => (
                    <Fragment key={metric.id}>
                      <tr>
                        <th scope="row" className="metricNameCell">
                          <button
                            type="button"
                            className="metricNameButton"
                            aria-label={`Explain ${metric.label}`}
                            aria-expanded={openMetricInfo === metric.id}
                            aria-controls={`manual-metric-info-${metric.id}`}
                            onClick={() => onToggleMetricInfo(metric.id)}
                          >
                            {metric.label}
                          </button>
                        </th>
                        <td className="metricValueCell">
                          <strong>{metric.value}</strong>
                          {metric.unit ? <span> {metric.unit}</span> : null}
                          {metric.detail ? <small className="metricValueDetail">{metric.detail}</small> : null}
                        </td>
                      </tr>
                      {openMetricInfo === metric.id && (
                        <tr id={`manual-metric-info-${metric.id}`} className="metricInfoRow">
                          <td colSpan={2}>
                            <div className="metricInfoInline">{strikeMetricInfo[metric.id]}</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
