export const DEFAULT_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 };
export const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
// 'bench' sits below 'low': the position's startable slots are all full and another
// player there cannot enter the lineup, so he is worth strictly less than his raw VBD
// suggests. Without it a backup QB outranks an unfilled starting WR.
export const NEED_TIERS = ['high', 'medium', 'low', 'bench', 'none'];

// K/DEF stay deprioritized until this many rounds remain (last 3 of 15).
export const LATE_ROUND_WINDOW = 3;

const STARTER_ORDER = ['QB', 'RB', 'WR', 'TE'];

export function slotLabels(slots) {
  const labels = [];
  for (const pos of STARTER_ORDER) {
    const count = slots[pos] || 0;
    for (let i = 1; i <= count; i += 1) labels.push(count === 1 ? pos : `${pos}${i}`);
  }
  for (let i = 1; i <= (slots.FLEX || 0); i += 1) labels.push(slots.FLEX === 1 ? 'FLEX' : `FLEX${i}`);
  for (const pos of ['K', 'DEF']) {
    const count = slots[pos] || 0;
    for (let i = 1; i <= count; i += 1) labels.push(count === 1 ? pos : `${pos}${i}`);
  }
  for (let i = 1; i <= (slots.BENCH || 0); i += 1) labels.push(`BN${i}`);
  return labels;
}

function slotAccepts(label) {
  if (label.startsWith('BN')) return ALL_POSITIONS;
  if (label.startsWith('FLEX')) return FLEX_POSITIONS;
  return [label.replace(/\d+$/, '')];
}

export function assignSlots(players, slots) {
  const labels = slotLabels(slots);
  const assigned = labels.map((label) => ({
    label,
    accepts: slotAccepts(label),
    player: null,
  }));

  // Best projection first, so the strongest player claims the earliest matching slot.
  const remaining = [...players].sort((a, b) => b.projectedPoints - a.projectedPoints);

  // Three passes, narrowest slots first: dedicated position slots, then FLEX, then bench.
  const passes = [
    (s) => !s.label.startsWith('BN') && !s.label.startsWith('FLEX'),
    (s) => s.label.startsWith('FLEX'),
    (s) => s.label.startsWith('BN'),
  ];

  for (const matchesPass of passes) {
    for (const slot of assigned) {
      if (!matchesPass(slot) || slot.player) continue;
      const idx = remaining.findIndex((pl) => slot.accepts.includes(pl.position));
      if (idx !== -1) slot.player = remaining.splice(idx, 1)[0];
    }
  }

  return assigned;
}

export function countByPosition(players) {
  const counts = {};
  for (const pos of ALL_POSITIONS) counts[pos] = 0;
  for (const pl of players) {
    if (counts[pl.position] !== undefined) counts[pl.position] += 1;
  }
  return counts;
}

// For each position: how many players there would be riding the bench if you drafted
// one more. Counting who is ALREADY benched is not enough — it reads zero for the very
// first surplus pick, which is exactly the one worth discouraging (a second kicker).
//
// A probe player scoring below everyone is appended and the roster re-assigned, so the
// probe lands in the least valuable slot still open. That makes FLEX fall out for free:
// while a FLEX slot can still absorb a third running back, the probe starts and the
// count stays 0.
export function benchDepthIfAdded(players, slots) {
  const depth = {};
  for (const pos of ALL_POSITIONS) {
    const probe = { id: '__probe__', name: '__probe__', position: pos, projectedPoints: -Infinity };
    depth[pos] = assignSlots([...players, probe], slots)
      .filter((slot) => slot.label.startsWith('BN') && slot.player && slot.player.position === pos)
      .length;
  }
  return depth;
}

export function positionalNeeds(players, slots, round, totalRounds) {
  const counts = countByPosition(players);
  const needs = {};

  // A FLEX-eligible player still has somewhere to start while the combined
  // RB/WR/TE starting slots plus FLEX are not yet covered.
  const flexCapacity = FLEX_POSITIONS.reduce((sum, p) => sum + (slots[p] || 0), 0) + (slots.FLEX || 0);
  const flexHeld = FLEX_POSITIONS.reduce((sum, p) => sum + counts[p], 0);
  const flexOpen = flexHeld < flexCapacity;

  for (const pos of SKILL_POSITIONS) {
    const required = slots[pos] || 0;
    const have = counts[pos];
    if (required === 0) needs[pos] = 'low';
    else if (have === 0) needs[pos] = 'high';
    else if (have < required) needs[pos] = 'medium';
    else if (FLEX_POSITIONS.includes(pos) && flexOpen) needs[pos] = 'low';
    else needs[pos] = 'bench';
  }

  const lateRounds = round > totalRounds - LATE_ROUND_WINDOW;
  for (const pos of ['K', 'DEF']) {
    const required = slots[pos] || 0;
    if (counts[pos] >= required) needs[pos] = 'none';
    else needs[pos] = lateRounds ? 'high' : 'none';
  }

  return needs;
}
