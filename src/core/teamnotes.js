import { assignSlots } from './roster.js';

// The core a team starts every week because it drafted it. Kicker and defense are left
// out for the same reason the grade leaves them out: they cost no draft capital and are
// replaced off waivers, so they say nothing about how the draft went.
export const SPINE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// assignSlots, not a re-implementation: the grade, the roster panel and this report are
// then incapable of disagreeing about who starts.
export function startingSpine(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => slot.player
      && !slot.label.startsWith('BN')
      && SPINE_POSITIONS.includes(slot.player.position))
    .map((slot) => ({ label: slot.label, player: slot.player }));
}

export function benchedPlayers(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => slot.label.startsWith('BN') && slot.player)
    .map((slot) => slot.player);
}

// Weeks where two or more STARTERS are off at once — the only players whose absence
// leaves a hole. A null bye is missing data, never a clash: two unknowns are not a known
// collision, which is the rule byeConflict already applies.
export function byeClashes(roster, slots) {
  const byWeek = new Map();
  for (const { player } of startingSpine(roster, slots)) {
    if (player.bye === null || player.bye === undefined) continue;
    if (!byWeek.has(player.bye)) byWeek.set(player.bye, []);
    byWeek.get(player.bye).push(player);
  }
  return [...byWeek.entries()]
    .filter(([, players]) => players.length >= 2)
    .map(([week, players]) => ({ week, players }))
    .sort((a, b) => b.players.length - a.players.length || a.week - b.week);
}
