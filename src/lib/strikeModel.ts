import type { LabeledRange } from './labels'
import type { Sample } from './sensor'

type FeatureColumn =
  | 'ax'
  | 'ay'
  | 'az'
  | 'gx'
  | 'gy'
  | 'gz'
  | 'grx'
  | 'gry'
  | 'grz'
  | 'acc_mag'
  | 'gyro_mag'

type ConvLayerArtifact = {
  outChannels: number
  inChannels: number
  kernelSize: number
  padding: number
  weight: number[]
  bias: number[]
}

type BatchNormLayerArtifact = {
  numFeatures: number
  eps: number
  weight: number[]
  bias: number[]
  runningMean: number[]
  runningVar: number[]
}

type LinearLayerArtifact = {
  inFeatures: number
  outFeatures: number
  weight: number[]
  bias: number[]
}

type StrikeModelArtifact = {
  version: string
  label: string
  labelMode: string
  labelEndPadding: number
  windowSize: number
  stride: number
  defaultThreshold: number
  featureCols: FeatureColumn[]
  featureMean: number[]
  featureStd: number[]
  modelSpec: {
    name: string
    in_channels: number
    conv_channels: number[]
    conv_kernel_sizes: number[]
    pool_after: boolean[]
    hidden_dim: number
    dropout: number
  }
  blocks: Array<{
    conv: ConvLayerArtifact
    batchNorm: BatchNormLayerArtifact
    usePool: boolean
  }>
  classifier: {
    linear1: LinearLayerArtifact
    linear2: LinearLayerArtifact
  }
}

export type StrikeWindowPrediction = {
  windowStart: number
  windowEnd: number
  centerIndex: number
  centerTimeSec: number
  probability: number
}

export type StrikeInferenceResult = {
  modelVersion: string
  label: string
  labelMode: string
  labelEndPadding: number
  windowSize: number
  stride: number
  defaultThreshold: number
  windowPredictions: StrikeWindowPrediction[]
}

export type PredictedStrikeRange = LabeledRange & {
  maxProbability: number
  meanProbability: number
  windowCount: number
}

let modelPromise: Promise<StrikeModelArtifact> | null = null

function featureValue(point: Sample, feature: FeatureColumn) {
  switch (feature) {
    case 'ax':
    case 'ay':
    case 'az':
    case 'gx':
    case 'gy':
    case 'gz':
    case 'grx':
    case 'gry':
    case 'grz':
      return point[feature]
    case 'acc_mag':
      return Math.hypot(point.ax, point.ay, point.az)
    case 'gyro_mag':
      return Math.hypot(point.gx, point.gy, point.gz)
  }
}

async function loadStrikeModelArtifact() {
  if (!modelPromise) {
    const url = `${import.meta.env.BASE_URL}models/strike-cnn-v1.json`
    modelPromise = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load strike model artifact from ${url}`)
      }

      const artifact = (await response.json()) as StrikeModelArtifact
      if (!artifact.featureCols?.length || !artifact.blocks?.length) {
        throw new Error('Strike model artifact is missing required fields')
      }

      return artifact
    })
  }

  return modelPromise
}

function buildNormalizedFeatureMatrix(points: Sample[], artifact: StrikeModelArtifact) {
  const featureCount = artifact.featureCols.length
  const features = new Float32Array(points.length * featureCount)

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex]
    const rowOffset = pointIndex * featureCount

    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      const rawValue = featureValue(point, artifact.featureCols[featureIndex])
      const mean = artifact.featureMean[featureIndex]
      const std = artifact.featureStd[featureIndex]
      features[rowOffset + featureIndex] = (rawValue - mean) / std
    }
  }

  return features
}

function buildWindowChannels(
  featureMatrix: Float32Array,
  startIndex: number,
  featureCount: number,
  windowSize: number,
) {
  const channels = Array.from({ length: featureCount }, () => new Float32Array(windowSize))

  for (let timeIndex = 0; timeIndex < windowSize; timeIndex += 1) {
    const sampleOffset = (startIndex + timeIndex) * featureCount
    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      channels[featureIndex][timeIndex] = featureMatrix[sampleOffset + featureIndex]
    }
  }

  return channels
}

function conv1dSame(input: Float32Array[], layer: ConvLayerArtifact) {
  const outputLength = input[0]?.length ?? 0
  const output = Array.from({ length: layer.outChannels }, () => new Float32Array(outputLength))

  for (let outChannel = 0; outChannel < layer.outChannels; outChannel += 1) {
    const outputChannel = output[outChannel]
    const outputChannelWeightOffset = outChannel * layer.inChannels * layer.kernelSize
    const bias = layer.bias[outChannel] ?? 0

    for (let timeIndex = 0; timeIndex < outputLength; timeIndex += 1) {
      let acc = bias

      for (let inChannel = 0; inChannel < layer.inChannels; inChannel += 1) {
        const inputChannel = input[inChannel]
        const weightOffset = outputChannelWeightOffset + inChannel * layer.kernelSize

        for (let kernelIndex = 0; kernelIndex < layer.kernelSize; kernelIndex += 1) {
          const inputIndex = timeIndex + kernelIndex - layer.padding
          if (inputIndex < 0 || inputIndex >= outputLength) continue
          acc += inputChannel[inputIndex] * layer.weight[weightOffset + kernelIndex]
        }
      }

      outputChannel[timeIndex] = acc
    }
  }

  return output
}

function batchNormRelu(input: Float32Array[], layer: BatchNormLayerArtifact) {
  const output = Array.from({ length: input.length }, () => new Float32Array(input[0]?.length ?? 0))

  for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
    const gamma = layer.weight[channelIndex]
    const beta = layer.bias[channelIndex]
    const runningMean = layer.runningMean[channelIndex]
    const runningVar = layer.runningVar[channelIndex]
    const invStd = 1 / Math.sqrt(runningVar + layer.eps)

    for (let timeIndex = 0; timeIndex < input[channelIndex].length; timeIndex += 1) {
      const normalized = ((input[channelIndex][timeIndex] - runningMean) * invStd) * gamma + beta
      output[channelIndex][timeIndex] = normalized > 0 ? normalized : 0
    }
  }

  return output
}

function maxPool1d(input: Float32Array[]) {
  const inputLength = input[0]?.length ?? 0
  const pooledLength = Math.floor(inputLength / 2)
  const output = Array.from({ length: input.length }, () => new Float32Array(pooledLength))

  for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
    for (let timeIndex = 0; timeIndex < pooledLength; timeIndex += 1) {
      const left = input[channelIndex][timeIndex * 2]
      const right = input[channelIndex][timeIndex * 2 + 1]
      output[channelIndex][timeIndex] = left > right ? left : right
    }
  }

  return output
}

function adaptiveAvgPool1d(input: Float32Array[]) {
  const pooled = new Float32Array(input.length)

  for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
    const channel = input[channelIndex]
    let sum = 0
    for (let timeIndex = 0; timeIndex < channel.length; timeIndex += 1) {
      sum += channel[timeIndex]
    }
    pooled[channelIndex] = channel.length ? sum / channel.length : 0
  }

  return pooled
}

function linear(input: Float32Array, layer: LinearLayerArtifact) {
  const output = new Float32Array(layer.outFeatures)

  for (let outIndex = 0; outIndex < layer.outFeatures; outIndex += 1) {
    const weightOffset = outIndex * layer.inFeatures
    let acc = layer.bias[outIndex] ?? 0

    for (let inIndex = 0; inIndex < layer.inFeatures; inIndex += 1) {
      acc += input[inIndex] * layer.weight[weightOffset + inIndex]
    }

    output[outIndex] = acc
  }

  return output
}

function reluVector(input: Float32Array) {
  const output = new Float32Array(input.length)

  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] > 0 ? input[index] : 0
  }

  return output
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function runStrikeModel(window: Float32Array[], artifact: StrikeModelArtifact) {
  let activations = window

  for (const block of artifact.blocks) {
    activations = batchNormRelu(conv1dSame(activations, block.conv), block.batchNorm)
    if (block.usePool) {
      activations = maxPool1d(activations)
    }
  }

  const pooled = adaptiveAvgPool1d(activations)
  const hidden = reluVector(linear(pooled, artifact.classifier.linear1))
  const logits = linear(hidden, artifact.classifier.linear2)

  return logits[0] ?? 0
}

export async function inferStrikeWindows(points: Sample[]): Promise<StrikeInferenceResult> {
  const artifact = await loadStrikeModelArtifact()

  if (points.length < artifact.windowSize) {
    return {
      modelVersion: artifact.version,
      label: artifact.label,
      labelMode: artifact.labelMode,
      labelEndPadding: artifact.labelEndPadding,
      windowSize: artifact.windowSize,
      stride: artifact.stride,
      defaultThreshold: artifact.defaultThreshold,
      windowPredictions: [],
    }
  }

  const featureMatrix = buildNormalizedFeatureMatrix(points, artifact)
  const windowPredictions: StrikeWindowPrediction[] = []
  const featureCount = artifact.featureCols.length

  for (let startIndex = 0; startIndex <= points.length - artifact.windowSize; startIndex += artifact.stride) {
    const endIndex = startIndex + artifact.windowSize - 1
    const centerIndex = startIndex + Math.floor(artifact.windowSize / 2)
    const window = buildWindowChannels(featureMatrix, startIndex, featureCount, artifact.windowSize)
    const probability = sigmoid(runStrikeModel(window, artifact))

    windowPredictions.push({
      windowStart: startIndex,
      windowEnd: endIndex,
      centerIndex,
      centerTimeSec: points[centerIndex]?.t ?? 0,
      probability,
    })
  }

  return {
    modelVersion: artifact.version,
    label: artifact.label,
    labelMode: artifact.labelMode,
    labelEndPadding: artifact.labelEndPadding,
    windowSize: artifact.windowSize,
    stride: artifact.stride,
    defaultThreshold: artifact.defaultThreshold,
    windowPredictions,
  }
}

export function buildPredictedStrikeRanges(
  points: Sample[],
  predictions: StrikeWindowPrediction[],
  threshold: number,
  stride: number,
  label = 'strike (model)',
): PredictedStrikeRange[] {
  if (!points.length || !predictions.length) return []

  const clampedThreshold = Math.min(1, Math.max(0, threshold))
  const positivePredictions = predictions.filter((prediction) => prediction.probability >= clampedThreshold)
  if (!positivePredictions.length) return []

  const effectiveStride = Math.max(1, stride)
  const rangePadding = Math.max(1, Math.floor(effectiveStride / 2))

  const ranges: PredictedStrikeRange[] = []
  let groupStart = 0

  const flushGroup = (groupEnd: number) => {
    const group = positivePredictions.slice(groupStart, groupEnd + 1)
    const startIndex = Math.max(0, group[0].centerIndex - rangePadding)
    const endIndex = Math.min(points.length - 1, group[group.length - 1].centerIndex + rangePadding)
    const probabilities = group.map((prediction) => prediction.probability)
    const maxProbability = Math.max(...probabilities)
    const meanProbability = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length

    ranges.push({
      id: `predicted-${startIndex}-${endIndex}-${group.length}`,
      label,
      startIndex,
      endIndex,
      startTimeSec: points[startIndex]?.t ?? 0,
      endTimeSec: points[endIndex]?.t ?? 0,
      durationSec: Math.max(0, (points[endIndex]?.t ?? 0) - (points[startIndex]?.t ?? 0)),
      sampleCount: endIndex - startIndex + 1,
      maxProbability,
      meanProbability,
      windowCount: group.length,
    })
  }

  for (let index = 1; index < positivePredictions.length; index += 1) {
    const prev = positivePredictions[index - 1]
    const current = positivePredictions[index]

    if (current.centerIndex - prev.centerIndex <= effectiveStride) continue

    flushGroup(index - 1)
    groupStart = index
  }

  flushGroup(positivePredictions.length - 1)
  return ranges
}
