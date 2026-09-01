// Abramowitz & Stegun 7.1.26, accurate to about 1e-7 — far beyond what five bands can
// use. Inline because this app takes no dependency, ever.
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Bands, not a percentage, and this is a measurement rather than a preference: real ADP
// ranges run 11% wider than a normal at the median and 34% wider at the p90, so the model
// is overconfident exactly in the tails, where a number looks most authoritative. Printing
// "13%" invites the reader to tell it from "24%" when the model cannot.
//
// The cut points are arbitrary in the way GRADE_BANDS is arbitrary: they label a
// continuum, they are stated here rather than buried, and a test pins them.
export const BANDS = [
  [0.85, 'Almost certainly still there'],
  [0.60, 'Likely still there'],
  [0.40, 'Coin flip'],
  [0.15, 'Likely gone'],
];

export function bandFor(probability) {
  for (const [floor, label] of BANDS) if (probability >= floor) return label;
  return 'Almost certainly gone';
}

// Returns null wherever the model has nothing honest to say — see the two refusals.
export function availabilityOdds(player, currentPick, nextPick) {
  if (!player || !nextPick || !currentPick) return null;

  const mu = player.adp;
  const sigma = player.adpStdev;
  // Explicit null/finite checks, NOT a falsy guard and NOT bare arithmetic: null in
  // arithmetic yields Infinity rather than NaN, so an unguarded model answers 0 or 1
  // with total confidence instead of failing. A sigma of 0 is no information, not
  // certainty.
  if (typeof mu !== 'number' || !Number.isFinite(mu)) return null;
  if (typeof sigma !== 'number' || !Number.isFinite(sigma) || sigma <= 0) return null;

  // Past everything ever observed, the model is extrapolating into the tail it is
  // measurably worst in. Refuse. Uses the data's own support as the boundary rather
  // than an invented threshold.
  if (typeof player.adpLatest === 'number' && currentPick > player.adpLatest) return null;

  if (nextPick <= currentPick) return { probability: 1, band: bandFor(1) };

  // Continuity correction on both, so the pair reconciles rather than drifting apart.
  const survivesToNext = 1 - normalCdf((nextPick - 0.5 - mu) / sigma);
  const survivedToNow = 1 - normalCdf((currentPick - 0.5 - mu) / sigma);
  if (!Number.isFinite(survivedToNow) || survivedToNow < 1e-9) return null;

  const probability = Math.max(0, Math.min(1, survivesToNext / survivedToNow));
  return { probability, band: bandFor(probability) };
}
