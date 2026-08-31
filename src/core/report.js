import { availablePlayers, isOffListId } from './state.js';
import { pickToSlot } from './snake.js';

// Grouped by position, never one list ordered by projection. Projected points are not
// position-normalised — a QB at a given rank projects roughly twice what an RB or WR at
// the same rank does — so a global ordering off the shipped pool returns nine
// quarterbacks and answers nobody's question. This is the same defect that made every
// sleeper a QB in chunk D, fixed the same way: compare within a position.
//
// K and DEF are absent on purpose: streamed week to week, out of the grade, and every
// team already holds one.
export const WAIVER_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const WAIVERS_PER_POSITION = 3;

export function stillOnWaivers(state, allPlayers, perPosition = WAIVERS_PER_POSITION) {
  const left = availablePlayers(state, allPlayers);
  return WAIVER_POSITIONS
    .map((position) => ({
      position,
      players: left
        .filter((pl) => pl.position === position)
        .sort((a, b) => b.projectedPoints - a.projectedPoints)
        .slice(0, perPosition),
    }))
    .filter((group) => group.players.length > 0);
}

// Every pick that can honestly be measured against ADP, with the three that cannot
// dropped rather than guessed at:
//
//   keepers      - held at a round the league agreed beforehand, not a draft decision.
//                  A round-15 keeper with an ADP of 5 scores as a 145-pick steal and
//                  would top the list in every draft that had one.
//   off-list     - no player exists behind the id at all.
//   no ADP       - nothing to measure. Covers 3 of the top 160 on the shipped pool.
//
// delta is picks past ADP: POSITIVE means he fell (a steal), NEGATIVE means he went
// early (a reach). Only the renderer, in a later task, negates it for display.
export function pickValues(state, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  const { numTeams, teams } = state.config;
  const out = [];

  for (const [key, entry] of Object.entries(state.picks)) {
    if (entry.isKeeper) continue;
    if (isOffListId(entry.playerId)) continue;
    const player = byId.get(entry.playerId);
    if (!player || player.adp === null || player.adp === undefined) continue;

    const pickNumber = Number(key);
    const team = teams[entry.teamIndex - 1];
    out.push({
      pickNumber,
      round: pickToSlot(pickNumber, numTeams).round,
      teamIndex: entry.teamIndex,
      teamName: team ? team.name : `Team ${entry.teamIndex}`,
      player,
      adp: player.adp,
      delta: Math.round((pickNumber - player.adp) * 10) / 10,
    });
  }

  return out.sort((a, b) => a.pickNumber - b.pickNumber);
}

// A delta of exactly zero is neither: he went at his ADP, and reporting that as a
// 0-pick steal would pad a section with a non-fact.
export function biggestSteals(values, limit = 5) {
  return values
    .filter((v) => v.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);
}

export function biggestReaches(values, limit = 5) {
  return values
    .filter((v) => v.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);
}
