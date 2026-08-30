// BPA rank sets the baseline ordering; VBD adjusts within tiers; need applies a
// multiplier small enough that it breaks ties without overriding real value gaps.
export const WEIGHTS = { bpa: 0.6, vbd: 0.4 };
// On the shipped 400-player pool one weighted rank is worth ~0.0015 and one VBD
// point ~0.0015, so a "clearly better player" gap of 30 ranks + 10 VBD points is
// ~0.060 while `high` swings ~0.031 on a typical value of ~0.77. Need therefore
// breaks a genuine near-tie (~0.006) without ever overriding a real value gap.
export const NEED_MULTIPLIER = { high: 1.04, medium: 1.02, low: 1.0, bench: 0.7, none: 0.45 };

// A projected-point gap this large to the next player at the position is a cliff.
export const CLIFF_THRESHOLD = 20;

// Picks past ADP before we call a player a value, or ahead of ADP before we call it a reach.
export const ADP_VALUE_GAP = 8;
export const ADP_REACH_GAP = 12;

const NEED_LABEL = { high: 'high need', medium: 'medium need', low: 'depth', none: 'not needed' };

// The VBD normalisation scale: the largest *positive* VBD in a pool, never an
// absolute value. A single zero-projection data row can sit hundreds of points
// below replacement, and using its magnitude as the scale would compress every
// real player's VBD into a sliver of its range.
export function maxPositiveVbd(players) {
  return players.reduce((max, pl) => Math.max(max, pl.vbd), 0) || 1;
}

// Each player already surplus at a position makes the next one there worth less: only
// one backup can cover a starter in any given week. Without this, cross-position VBD
// keeps favouring shallow-baseline positions late (a 4th TE still scores near TE12
// while a 5th WR is measured against WR24), and the bench fills with backups for
// positions that start one player.
export const BENCH_DECAY = 0.35;

// Kickers and defenses are streamed off waivers week to week, so a rostered backup is
// worth close to nothing — far less than a spare running back. They decay much harder.
export const STREAMED_POSITIONS = ['K', 'DEF'];
export const BENCH_DECAY_STREAMED = 2;

export function scorePlayer(player, ctx) {
  const { poolSize, vbdScale, needs, surplus } = ctx;

  // Both components normalize into [0, 1] so the multiplier can never flip a sign.
  const bpaScore = Math.max(0, (poolSize - (player.overallRank - 1)) / poolSize);
  const scale = vbdScale > 0 ? vbdScale : 1;
  const clamped = Math.max(-1, Math.min(1, player.vbd / scale));
  const vbdScore = (clamped + 1) / 2;

  const value = WEIGHTS.bpa * bpaScore + WEIGHTS.vbd * vbdScore;
  let multiplier = NEED_MULTIPLIER[needs[player.position]] ?? 1;

  // Decay on how many at this position would already be riding the bench, whatever the
  // tier says. This is the signal that matters — a second kicker and a fourth tight end
  // are both unplayable — and it stays at zero while a FLEX slot can still absorb one.
  const onBench = surplus ? surplus[player.position] || 0 : 0;
  if (onBench > 0) {
    const decay = STREAMED_POSITIONS.includes(player.position) ? BENCH_DECAY_STREAMED : BENCH_DECAY;
    multiplier /= 1 + decay * onBench;
  }

  return value * multiplier;
}

function nextAtPosition(player, pool) {
  return pool
    .filter((x) => x.position === player.position && x.id !== player.id)
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .find((x) => x.projectedPoints <= player.projectedPoints) || null;
}

export function reasonsFor(player, pool, ctx) {
  const { needs, currentPick } = ctx;
  const reasons = [];

  const next = nextAtPosition(player, pool);
  if (next) {
    const gap = Math.round(player.projectedPoints - next.projectedPoints);
    if (gap >= CLIFF_THRESHOLD) {
      reasons.push(`Big drop-off at ${player.position} — next ${player.position} projects ${gap} pts lower`);
    }
  }

  const tier = needs[player.position];
  if (tier === 'high' || tier === 'medium') {
    reasons.push(`Fills your ${player.position} slot (${NEED_LABEL[tier]})`);
  }

  if (player.adp !== null && player.adp !== undefined) {
    const past = Math.round(currentPick - player.adp);
    if (past >= ADP_VALUE_GAP) {
      reasons.push(`Value — ${past} picks past his ADP of ${Math.round(player.adp)}`);
    } else if (-past >= ADP_REACH_GAP) {
      reasons.push(`Slight reach — ADP is ${Math.round(player.adp)}, ${-past} picks from now`);
    }
  }

  if (reasons.length === 0) {
    const over = Math.round(player.vbd);
    reasons.push(`Best value on the board (${over >= 0 ? '+' : ''}${over} over replacement)`);
  }

  return reasons.slice(0, 2);
}

// A sleeper is a gamble, so the bar is deliberately higher than the "Value" reason
// already shown on recommendation cards (ADP_VALUE_GAP, 8 picks). Anything lower and
// the two lists would say the same thing about the same player.
export const SLEEPER_ADP_GAP = 15;
// How many overall ranks either side to compare a player's projection against.
export const SLEEPER_RANK_BAND = 20;
export const SLEEPER_PROJECTION_EDGE = 15;

// Enough neighbours that a median means something; below this the band is too sparse
// near the very top or bottom of the pool to judge anyone against.
const MIN_BAND_NEIGHBOURS = 3;

function picksPastAdp(player, currentPick) {
  if (player.adp === null || player.adp === undefined) return null;
  return currentPick - player.adp;
}

function projectionEdge(player, pool) {
  const near = pool.filter((x) => x.id !== player.id
    && Math.abs(x.overallRank - player.overallRank) <= SLEEPER_RANK_BAND / 2);
  if (near.length < MIN_BAND_NEIGHBOURS) return null;
  const points = near.map((x) => x.projectedPoints).sort((a, b) => a - b);
  const median = points[Math.floor(points.length / 2)];
  return player.projectedPoints - median;
}

// Gambles, kept apart from the top three on purpose: mixing them in would let a flier
// displace the best available player without the user ever choosing to take the risk.
export function sleepers(pool, ctx, limit = 2) {
  const exclude = ctx.excludeIds || new Set();
  const found = [];

  for (const player of pool) {
    if (exclude.has(player.id)) continue;

    const past = picksPastAdp(player, ctx.currentPick);
    if (past !== null && past >= SLEEPER_ADP_GAP) {
      found.push({
        player,
        rank: past,
        why: `Still here ${Math.round(past)} picks past his ADP of ${Math.round(player.adp)}`,
      });
      continue;
    }

    const edge = projectionEdge(player, pool);
    if (edge !== null && edge >= SLEEPER_PROJECTION_EDGE) {
      found.push({
        player,
        rank: edge,
        why: `Projects ${Math.round(edge)} pts above the players ranked around him`,
      });
    }
  }

  return found
    .sort((a, b) => b.rank - a.rank || a.player.overallRank - b.player.overallRank)
    .slice(0, limit)
    .map(({ player, why }) => ({ player, why }));
}

export function recommend(pool, ctx, limit = 3) {
  if (pool.length === 0) return [];

  // Replacement levels are fixed for the whole draft, so the VBD scale must be too.
  // Callers pass ctx.vbdScale, derived once from the full pool; deriving it from the
  // shrinking live pool instead would make one VBD point worth more every round until
  // VBD swamped the BPA baseline. The live-pool fallback keeps recommend() usable standalone.
  const vbdScale = ctx.vbdScale > 0 ? ctx.vbdScale : maxPositiveVbd(pool);
  // overallRank is a fixed whole-pool rank that never renumbers as players are drafted,
  // so the BPA denominator must track the highest rank still present, not pool.length.
  const poolSize = pool.reduce((max, pl) => Math.max(max, pl.overallRank), pool.length);
  const scoreCtx = { poolSize, vbdScale, needs: ctx.needs, surplus: ctx.surplus };

  return pool
    .map((player) => ({ player, score: scorePlayer(player, scoreCtx) }))
    .sort((a, b) => b.score - a.score || a.player.overallRank - b.player.overallRank)
    .slice(0, limit)
    .map(({ player, score }) => ({
      player,
      score,
      need: ctx.needs[player.position],
      reasons: reasonsFor(player, pool, ctx),
    }));
}
