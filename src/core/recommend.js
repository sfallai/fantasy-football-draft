// BPA rank sets the baseline ordering; VBD adjusts within tiers; need applies a
// multiplier small enough that it breaks ties without overriding real value gaps.
export const WEIGHTS = { bpa: 0.6, vbd: 0.4 };
export const NEED_MULTIPLIER = { high: 1.25, medium: 1.12, low: 1.0, none: 0.55 };

// A projected-point gap this large to the next player at the position is a cliff.
export const CLIFF_THRESHOLD = 20;

// Picks past ADP before we call a player a value, or ahead of ADP before we call it a reach.
export const ADP_VALUE_GAP = 8;
export const ADP_REACH_GAP = 12;

const NEED_LABEL = { high: 'high need', medium: 'medium need', low: 'depth', none: 'not needed' };

export function scorePlayer(player, ctx) {
  const { poolSize, maxAbsVbd, needs } = ctx;

  // Both components normalize into [0, 1] so the multiplier can never flip a sign.
  const bpaScore = Math.max(0, (poolSize - (player.overallRank - 1)) / poolSize);
  const scale = maxAbsVbd || 1;
  const clamped = Math.max(-1, Math.min(1, player.vbd / scale));
  const vbdScore = (clamped + 1) / 2;

  const value = WEIGHTS.bpa * bpaScore + WEIGHTS.vbd * vbdScore;
  const multiplier = NEED_MULTIPLIER[needs[player.position]] ?? 1;
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
      reasons.push(`Value — ${past} picks past his ADP of ${player.adp}`);
    } else if (-past >= ADP_REACH_GAP) {
      reasons.push(`Slight reach — ADP is ${player.adp}, ${-past} picks from now`);
    }
  }

  if (reasons.length === 0) {
    reasons.push(`Best value on the board (+${Math.round(player.vbd)} over replacement)`);
  }

  return reasons.slice(0, 2);
}

export function recommend(pool, ctx, limit = 3) {
  if (pool.length === 0) return [];

  const maxAbsVbd = pool.reduce((max, pl) => Math.max(max, Math.abs(pl.vbd)), 0);
  const scoreCtx = { poolSize: pool.length, maxAbsVbd, needs: ctx.needs };

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
