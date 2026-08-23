import { pickToSlot } from './snake.js';
import { positionalNeeds, SKILL_POSITIONS } from './roster.js';

export const RUN_RISK_THRESHOLD = 2;
const NOTE_POSITIONS = SKILL_POSITIONS;
const MAX_NOTES = 3;

export function teamsPickingBetween(currentPick, nextPick, numTeams) {
  if (!nextPick) return [];
  const teams = [];
  for (let pick = currentPick + 1; pick < nextPick; pick += 1) {
    teams.push(pickToSlot(pick, numTeams).teamIndex);
  }
  return teams;
}

export function needCountsBetween({ currentPick, nextPick, numTeams, rounds, rostersByTeam, slots }) {
  const counts = {};
  for (const pos of NOTE_POSITIONS) counts[pos] = 0;

  for (let pick = currentPick + 1; nextPick && pick < nextPick; pick += 1) {
    const { round, teamIndex } = pickToSlot(pick, numTeams);
    const roster = rostersByTeam[teamIndex] || [];
    const needs = positionalNeeds(roster, slots, round, rounds);
    for (const pos of NOTE_POSITIONS) {
      if (needs[pos] === 'high' || needs[pos] === 'medium') counts[pos] += 1;
    }
  }

  return counts;
}

export function competitiveNotes({
  currentPick, nextPick, numTeams, rounds, rostersByTeam, slots, pool, replacement,
}) {
  const between = teamsPickingBetween(currentPick, nextPick, numTeams);
  if (between.length === 0) return [];

  const counts = needCountsBetween({ currentPick, nextPick, numTeams, rounds, rostersByTeam, slots });

  const notes = [];
  for (const pos of NOTE_POSITIONS) {
    const demand = counts[pos];
    if (demand < RUN_RISK_THRESHOLD) continue;

    // Supply = players at this position still projecting above replacement level.
    const supply = pool.filter(
      (pl) => pl.position === pos && pl.projectedPoints > (replacement[pos] || 0),
    ).length;
    if (supply === 0 || supply > demand) continue;

    notes.push(
      `${pos}: ${demand} of the ${between.length} picks before your next need ${pos}, ` +
      `and only ${supply} starter-grade ${pos}${supply === 1 ? '' : 's'} remain — consider taking one now`,
    );
  }

  return notes
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_NOTES);
}
