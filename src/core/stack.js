// A stack is a quarterback and a pass-catcher on the same NFL team: one throw scores for
// both. Two running backs on one team are a committee — they split the same carries
// rather than sharing a play — and two receivers compete for the same targets.
const CATCHERS = ['WR', 'TE'];

// Free agents all carry 'FA', so a team code alone is not proof of a shared team.
const UNKNOWN_TEAM = 'FA';

function pairsWith(position) {
  if (position === 'QB') return CATCHERS;
  if (CATCHERS.includes(position)) return ['QB'];
  return [];
}

// The owned player this one would pair with, or null. States the pairing and nothing
// more: whether a stack is *good* in a season-long non-PPR league is a judgement this
// data cannot support, and the app does not make judgements it cannot compute.
export function stackPartner(player, roster) {
  if (!player || !player.team || player.team === UNKNOWN_TEAM) return null;
  const wanted = pairsWith(player.position);
  if (wanted.length === 0) return null;

  return (roster || [])
    .filter((owned) => owned
      && owned.team === player.team
      // Unreachable today and kept deliberately: no position pairs with its own, so a
      // candidate can never match himself on position. It becomes load-bearing the day
      // someone adds a same-position pairing — and tests/stack.test.js goes red on the
      // same day to say so.
      && owned.id !== player.id
      && wanted.includes(owned.position))
    .sort((a, b) => b.projectedPoints - a.projectedPoints)[0] || null;
}
