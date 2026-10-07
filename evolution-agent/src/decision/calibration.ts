export interface CalibrationExample {
  scores: number[];
  actualClass: number;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
}

export interface CalibrationMetrics {
  samples: number;
  ece: number;
  brierScore: number;
  nll: number;
  reliability: ReliabilityBin[];
}

export interface CalibrationFit {
  method: 'temperature_scaling';
  temperature: number;
  trainingSamples: number;
  validation: CalibrationMetrics;
  test?: CalibrationMetrics;
}

function assertExample(example: CalibrationExample): void {
  if (example.scores.length < 2 || !example.scores.every(Number.isFinite)) throw new Error('Calibration scores must contain at least two finite values');
  if (!Number.isInteger(example.actualClass) || example.actualClass < 0 || example.actualClass >= example.scores.length) throw new Error('Actual class is outside the score distribution');
}

export function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - max));
  const sum = exponentials.reduce((total, value) => total + value, 0);
  return exponentials.map((value) => value / sum);
}

export function applyTemperature(scores: number[], temperature: number): number[] {
  if (!Number.isFinite(temperature) || temperature <= 0) throw new Error('Temperature must be positive and finite');
  return softmax(scores.map((score) => score / temperature));
}

function meanNll(examples: CalibrationExample[], temperature: number): number {
  return examples.reduce((total, example) => {
    assertExample(example);
    const probs = applyTemperature(example.scores, temperature);
    return total - Math.log(Math.max(probs[example.actualClass] || 0, 1e-15));
  }, 0) / examples.length;
}

/** Golden-section minimization of held-in calibration NLL over log-temperature. */
export function fitTemperature(examples: CalibrationExample[]): number {
  if (examples.length < 2) throw new Error('At least two calibration-split examples are required to fit temperature scaling');
  const ratio = (Math.sqrt(5) - 1) / 2;
  let left = Math.log(0.05);
  let right = Math.log(20);
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let f1 = meanNll(examples, Math.exp(x1));
  let f2 = meanNll(examples, Math.exp(x2));
  for (let i = 0; i < 120; i++) {
    if (f1 <= f2) {
      right = x2; x2 = x1; f2 = f1;
      x1 = right - ratio * (right - left); f1 = meanNll(examples, Math.exp(x1));
    } else {
      left = x1; x1 = x2; f1 = f2;
      x2 = left + ratio * (right - left); f2 = meanNll(examples, Math.exp(x2));
    }
  }
  return Math.exp((left + right) / 2);
}

export function evaluateCalibration(examples: CalibrationExample[], temperature: number, binCount = 10): CalibrationMetrics {
  if (!examples.length) throw new Error('Validation or test split must contain labeled examples');
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error('Reliability bin count must be positive');
  const bins = Array.from({ length: binCount }, (_, index) => ({ lower: index / binCount, upper: (index + 1) / binCount, count: 0, confidence: 0, correct: 0 }));
  let ece = 0;
  let brierScore = 0;
  let nll = 0;
  for (const example of examples) {
    assertExample(example);
    const probabilities = applyTemperature(example.scores, temperature);
    const prediction = probabilities.indexOf(Math.max(...probabilities));
    const confidence = probabilities[prediction];
    const correct = prediction === example.actualClass ? 1 : 0;
    const binIndex = Math.min(binCount - 1, Math.floor(confidence * binCount));
    const bin = bins[binIndex]; bin.count++; bin.confidence += confidence; bin.correct += correct;
    ece += Math.abs(confidence - correct);
    brierScore += probabilities.reduce((sum, probability, index) => sum + (probability - (index === example.actualClass ? 1 : 0)) ** 2, 0);
    nll -= Math.log(Math.max(probabilities[example.actualClass] || 0, 1e-15));
  }
  const total = examples.length;
  return {
    samples: total,
    ece: ece / total,
    brierScore: brierScore / total,
    nll: nll / total,
    reliability: bins.filter((bin) => bin.count > 0).map((bin) => ({ lower: bin.lower, upper: bin.upper, count: bin.count, meanConfidence: bin.confidence / bin.count, accuracy: bin.correct / bin.count })),
  };
}

export function fitAndEvaluateCalibration(training: CalibrationExample[], validation: CalibrationExample[], test?: CalibrationExample[]): CalibrationFit {
  if (!validation.length) throw new Error('A separate validation split is required; calibration samples cannot evaluate their own fit');
  const temperature = fitTemperature(training);
  return { method: 'temperature_scaling', temperature, trainingSamples: training.length, validation: evaluateCalibration(validation, temperature), ...(test?.length ? { test: evaluateCalibration(test, temperature) } : {}) };
}
