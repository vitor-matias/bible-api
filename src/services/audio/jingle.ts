/**
 * Where a short template (the +365 podcast's end-of-reading jingle) best
 * lines up in a signal: normalised cross-correlation, every `step` samples.
 * Its score runs to 1 for the same sound; a voice over it lowers it.
 */
export const findTemplate = (
  signal: Float32Array,
  template: Float32Array,
  step = 8,
): { index: number; score: number } => {
  const n = template.length
  let norm = 0
  for (const v of template) norm += v * v
  norm = Math.sqrt(norm)
  let best = { index: -1, score: -1 }
  for (let i = 0; i + n <= signal.length; i += step) {
    let dot = 0
    let energy = 0
    for (let j = 0; j < n; j++) {
      dot += template[j] * signal[i + j]
      energy += signal[i + j] * signal[i + j]
    }
    const score = dot / (norm * Math.sqrt(energy) || 1)
    if (score > best.score) best = { index: i, score }
  }
  return best
}
