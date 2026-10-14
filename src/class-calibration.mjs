// Intercepts correct class-frequency drift on a separate calibration partition.
// They do not change the classifier, event labels, costs or publication threshold.
export function adjustClassProbabilities(probabilities, calibration) {
  if (!calibration) return probabilities;
  if (!Array.isArray(probabilities) || probabilities.length !== 3 || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1) ||
      calibration.method !== 'regularized-class-intercepts' || !Array.isArray(calibration.bias) || calibration.bias.length !== 3 || calibration.bias.some(b => !Number.isFinite(b))) return null;
  const logits = probabilities.map((p, k) => Math.log(Math.max(p, 1e-15)) + calibration.bias[k]);
  const maximum = Math.max(...logits), masses = logits.map(x => Math.exp(x - maximum)), total = masses.reduce((a, b) => a + b, 0);
  return masses.map(x => x / total);
}

export function fitClassCalibration(rows, {iterations = 300, regularization = .02} = {}) {
  if (!Array.isArray(rows) || rows.length < 50 || rows.some(r => !Array.isArray(r.probabilities) || r.probabilities.length !== 3 ||
      r.probabilities.some(p => !Number.isFinite(p) || p <= 0 || p > 1) || Math.abs(r.probabilities.reduce((a,b) => a+b,0)-1)>1e-9 || !Number.isInteger(r.actual) || r.actual < 0 || r.actual > 2)) return null;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000 || !Number.isFinite(regularization) || regularization <= 0) return null;
  const calibration = {method:'regularized-class-intercepts', bias:[0,0,0], sample:rows.length, regularization, iterations, partition:'calibration', holdoutUsed:false};
  for (let i = 0; i < iterations; i++) {
    const gradient = [0,0,0];
    for (const row of rows) {
      const p = adjustClassProbabilities(row.probabilities, calibration);
      for (let k = 0; k < 3; k++) gradient[k] += p[k] - (row.actual === k ? 1 : 0);
    }
    for (let k = 0; k < 3; k++) calibration.bias[k] -= .2 * (gradient[k] / rows.length + regularization * calibration.bias[k]);
    const mean = calibration.bias.reduce((a,b) => a+b,0) / 3;
    calibration.bias = calibration.bias.map(b => b-mean);
  }
  return calibration;
}
