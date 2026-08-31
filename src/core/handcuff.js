import { assignSlots } from './roster.js';

// A handcuff is the backup who INHERITS THE WORKLOAD when the starter goes down. That
// is a running-back fact: one back takes the carries, so his value is contingent on the
// starter's health in a way nobody else's is. Everywhere else the rank-2 player is
// simply another player.
//
// WR and TE do not work that way — targets are redistributed among several receivers,
// and the WR2 on a depth chart is a starter in his own right. Measured on the shipped
// 400-player pool, in-pool pairs whose *backup* is himself top-100 overall:
//
//   RB  64 pairs |  4      WR  87 pairs | 17      TE  23 pairs | 0      QB  14 pairs | 0
//
// Seventeen of the WR pairs name a top-100 starter as somebody's "handcuff", and the
// four most-viewed cards in the app all carried one: Chase → Tee Higgins (#45), Nacua →
// Davante Adams (#31), St. Brown → Jameson Williams (#48), Lamb → George Pickens (#28).
//
// QB is excluded deliberately even though a backup quarterback DOES inherit the job: in
// a one-QB league nobody drafts one, so the line would be noise on every QB card for no
// decision it could change. Do not "fix" this back.
//
// K and DEF are streamed off waivers week to week, are already out of the grade, and
// have no depth-chart entry — but a stale id on one must not leak into the filter.
export const HANDCUFF_POSITIONS = ['RB'];

// The ids that back up this roster's STARTERS. assignSlots, not a re-derivation: the
// grade, the roster panel, the report card and this all have to agree about who starts,
// and sharing the one function is what makes disagreeing impossible.
//
// Starters only. A fourth running back's backup is depth for depth, which is not what
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
