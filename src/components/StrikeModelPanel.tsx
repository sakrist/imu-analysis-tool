import { Fragment } from 'react'
import { fmt } from '../lib/sensor'
import type { StrikeWindowMetrics } from '../lib/strikeMetrics'
import type { SelectedPredictedMetricItem, StrikeMetricInfoKey } from '../lib/strikeInsights'
import { type PredictedStrikeRange, type StrikeInferenceResult } from '../lib/strikeModel'

type StrikeModelPanelProps = {
  filteredPredictedRangeCount: number
  isCollapsed: boolean
  minPeakJerkGPerSec: number
  minPreImpactHurleyHandleSpeedMps: number
  minSwingDurationToImpactMs: number
  modelError: string
  modelPredictedRangesCount: number
  modelStatus: 'idle' | 'loading' | 'ready' | 'error'
  onPredictionThresholdInputChange: (value: string) => void
  onSelectPredictedRange: (range: PredictedStrikeRange) => void
  onToggleCollapsed: () => void
  onToggleMetricInfo: (metricId: StrikeMetricInfoKey) => void
  onToggleShowModelPredictions: (checked: boolean) => void
  openMetricInfo: StrikeMetricInfoKey | null
  positivePredictionCount: number
  predictedRanges: PredictedStrikeRange[]
  predictionThreshold: number
  predictionThresholdInput: string
  selectedPredictedMetricItems: SelectedPredictedMetricItem[]
  selectedPredictedRange: PredictedStrikeRange | null
  selectedPredictedRangeMetrics: StrikeWindowMetrics | null
  showModelPredictions: boolean
  strikeInference: StrikeInferenceResult | null
  strikeMetricInfo: Record<StrikeMetricInfoKey, string>
}

export function StrikeModelPanel({
  filteredPredictedRangeCount,
  isCollapsed,
  minPeakJerkGPerSec,
  minPreImpactHurleyHandleSpeedMps,
  minSwingDurationToImpactMs,
  modelError,
  modelPredictedRangesCount,
  modelStatus,
  onPredictionThresholdInputChange,
  onSelectPredictedRange,
  onToggleCollapsed,
  onToggleMetricInfo,
  onToggleShowModelPredictions,
  openMetricInfo,
  positivePredictionCount,
  predictedRanges,
  predictionThreshold,
  predictionThresholdInput,
  selectedPredictedMetricItems,
  selectedPredictedRange,
  selectedPredictedRangeMetrics,
  showModelPredictions,
  strikeInference,
  strikeMetricInfo,
}: StrikeModelPanelProps) {
  return (
    <section className="labelingCard">
      <div className="labelingHeader">
        <button
          className="collapseToggle"
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} Strike Model`}
        >
          <span>{isCollapsed ? '▸' : '▾'}</span>
          <span>Strike Model</span>
        </button>
        <span>{modelStatus === 'ready' ? `${predictedRanges.length.toLocaleString()} ranges` : modelStatus}</span>
      </div>
      {!isCollapsed && (
        <div className="labelingBody">
          <div className="modelStatusRow">
            <span className={`statusBadge ${modelStatus}`}>
              {modelStatus === 'idle' && 'Waiting for data'}
              {modelStatus === 'loading' && 'Running inference'}
              {modelStatus === 'ready' && 'Model ready'}
            </span>
            {strikeInference && (
              <span className="modelMeta">
                {strikeInference.modelVersion} · {strikeInference.windowSize}-sample windows · stride {strikeInference.stride}
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
                onChange={(event) => onPredictionThresholdInputChange(event.target.value)}
                disabled={modelStatus !== 'ready'}
              />
            </label>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={showModelPredictions}
                onChange={(event) => onToggleShowModelPredictions(event.target.checked)}
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
                  )}, merged into ${modelPredictedRangesCount.toLocaleString()} model ranges. ${predictedRanges.length.toLocaleString()} ranges pass peak jerk >= ${minPeakJerkGPerSec.toLocaleString()} g/s, swing duration to impact >= ${minSwingDurationToImpactMs.toLocaleString()} ms, and pre-impact hurley handle speed >= ${minPreImpactHurleyHandleSpeedMps.toLocaleString()} m/s${
                    filteredPredictedRangeCount > 0 ? ` (${filteredPredictedRangeCount.toLocaleString()} filtered out).` : '.'
                  }`
                : 'Load a sensor CSV to run the bundled strike detector.'}
          </p>

          {!!predictedRanges.length && !selectedPredictedRange && (
            <p className="labelingHint">Select a predicted strike below to make it the active range and inspect metrics.</p>
          )}

          {!!predictedRanges.length && (
            <div className="rangeList">
              {predictedRanges.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  className={`rangeListItem rangeListItemButton${selectedPredictedRange?.id === range.id ? ' isActive' : ''}`}
                  onClick={() => onSelectPredictedRange(range)}
                >
                  <span className="rangeListCopy">
                    <b>{range.label}</b> [{range.startIndex}-{range.endIndex}] {fmt(range.startTimeSec)}s to {fmt(range.endTimeSec)}s (
                    {range.sampleCount.toLocaleString()} samples, max p={range.maxProbability.toFixed(2)})
                  </span>
                  <span className="rangeListAction">{selectedPredictedRange?.id === range.id ? 'Selected' : 'Select'}</span>
                </button>
              ))}
            </div>
          )}

          {selectedPredictedRange && selectedPredictedRangeMetrics && (
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
                      <span className="metricNameText">Selected Predicted Strike</span>
                    </th>
                    <td className="metricValueCell">[{selectedPredictedRange.startIndex}-{selectedPredictedRange.endIndex}]</td>
                  </tr>
                  <tr>
                    <th scope="row" className="metricNameCell">
                      <span className="metricNameText">Max Prediction</span>
                    </th>
                    <td className="metricValueCell">
                      <strong>{selectedPredictedRange.maxProbability.toFixed(2)}</strong>
                    </td>
                  </tr>
                  {selectedPredictedMetricItems.map((metric) => (
                    <Fragment key={metric.id}>
                      <tr>
                        <th scope="row" className="metricNameCell">
                          <button
                            type="button"
                            className="metricNameButton"
                            aria-label={`Explain ${metric.label}`}
                            aria-expanded={openMetricInfo === metric.id}
                            aria-controls={`metric-info-${metric.id}`}
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
                        <tr id={`metric-info-${metric.id}`} className="metricInfoRow">
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
