import { ALL_POSITIONS } from './roster.js';

// One FLEX slot per team is split across RB/WR/TE by how often each actually fills it.
export const FLEX_SHARE = { RB: 0.4, WR: 0.4, TE: 0.2 };

// Teams carry a backup QB, so the QB replacement level sits past one-per-team.
export const QB_DEPTH_FACTOR = 1.2;

export function baselineRanks(numTeams, slots) {
  const flex = slots.FLEX || 0;
  const ranks = {};

  ranks.QB = Math.max(1, Math.floor(numTeams * (slots.QB || 0) * QB_DEPTH_FACTOR));
  for (const pos of ['RB', 'WR', 'TE']) {
    const perTeam = (slots[pos] || 0) + (FLEX_SHARE[pos] || 0) * flex;
    ranks[pos] = Math.max(1, Math.round(numTeams * perTeam));
  }
  for (const pos of ['K', 'DEF']) {
    ranks[pos] = Math.max(1, Math.round(numTeams * (slots[pos] || 0)));
  }

  return ranks;
}

export function replacementPoints(allPlayers, numTeams, slots) {
  const ranks = baselineRanks(numTeams, slots);
  const byPosition = {};
  for (const pos of ALL_POSITIONS) byPosition[pos] = [];
  for (const pl of allPlayers) {
    if (byPosition[pl.position]) byPosition[pl.position].push(pl);
  }

  const replacement = {};
  for (const pos of ALL_POSITIONS) {
    const sorted = byPosition[pos].sort((a, b) => b.projectedPoints - a.projectedPoints);
    if (sorted.length === 0) {
      replacement[pos] = 0;
      continue;
    }
    // Clamp to the shallowest available player when the pool is thinner than the baseline.
    const index = Math.min(ranks[pos], sorted.length) - 1;
    replacement[pos] = sorted[index].projectedPoints;
  }

  return replacement;
}

export function withVbd(allPlayers, replacement) {
  return allPlayers.map((pl) => ({
    ...pl,
    vbd: Math.round((pl.projectedPoints - (replacement[pl.position] || 0)) * 10) / 10,
  }));
}
