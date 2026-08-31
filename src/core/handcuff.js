import { assignSlots } from './roster.js';

// The positions a handcuff means anything for. K and DEF are streamed off waivers week
// to week, are already out of the grade, and have no depth-chart entry — but a stale id
// on one must not leak into the filter.
export const HANDCUFF_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// The ids that back up this roster's STARTERS. assignSlots, not a re-derivation: the
// grade, the roster panel, the report card and this all have to agree about who starts,
// and sharing the one function is what makes disagreeing impossible.
//
// Starters only. A second quarterback's backup is depth for depth, which is not what
// anyone means by a handcuff and would fill the filter with noise.
export function handcuffIdsFor(roster, slots) {
  const ids = new Set();
  for (const slot of assignSlots(roster, slots)) {
    if (!slot.player || slot.label.startsWith('BN')) continue;
    if (!HANDCUFF_POSITIONS.includes(slot.player.position)) continue;
    if (slot.player.backupId) ids.add(slot.player.backupId);
  }
  return ids;
}
