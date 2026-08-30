import { el, clear, POSITION_COLORS } from './dom.js';
import { assignSlots, positionalNeeds, countByPosition, ALL_POSITIONS, NEED_TIERS, LATE_ROUND_WINDOW, FLEX_POSITIONS } from '../core/roster.js';
import { slotRow } from './slotrow.js';

function needLabel(position, tier, have, required, totalRounds) {
  if (position === 'K' || position === 'DEF') {
    if (tier === 'none' && have >= required) return `${position} set`;
    if (tier === 'none') return `wait until round ${totalRounds - LATE_ROUND_WINDOW + 1}`;
    return `${position} needed`;
  }
  if (tier === 'high') return required > 1 ? `${position}1 needed` : `${position} needed`;
  if (tier === 'medium') return `${position}${have + 1} needed`;
  // 'bench' means every startable slot at this position is full: this is a plain
  // confirmation, not a weak recommendation to keep drafting there.
  if (tier === 'bench') return `${position} set`;
  // 'low' is still a ranked row — starters are covered but a FLEX slot (for a
  // FLEX-eligible position) or nothing further (for one that isn't) could still take
  // one. "set" is reserved for rows that are actually out of the ranking (tier
  // 'bench', above), so this must never say it.
  return FLEX_POSITIONS.includes(position) ? 'FLEX / bench depth' : 'depth only';
}

export function needSummary(roster, slots, round, totalRounds) {
  const needs = positionalNeeds(roster, slots, round, totalRounds);
  const counts = countByPosition(roster);

  return ALL_POSITIONS
    .map((position) => {
      const tier = needs[position];
      const have = counts[position];
      const required = slots[position] || 0;
      return {
        position,
        tier,
        // "Set" means every startable slot at this position is full, so another player
        // there cannot enter the lineup. For the skill positions that is exactly the
        // 'bench' tier. K and DEF never reach 'bench' — positionalNeeds drops a filled
        // one straight to 'none' — so they need the second clause, or a full kicker
        // would print "K set" on a *ranked* row and sort above genuinely-set rows.
        //
        // The fix belongs here and not in positionalNeeds: retiering a filled K/DEF to
        // 'bench' would raise its NEED_MULTIPLIER from 0.45 to 0.7, making a surplus
        // kicker *less* penalised in scorePlayer and fighting BENCH_DECAY_STREAMED.
        // The tier is a scoring input; `set` is a display fact about the lineup.
        set: tier === 'bench' || ((position === 'K' || position === 'DEF') && have >= required),
        label: needLabel(position, tier, have, required, totalRounds),
      };
    })
    .sort((a, b) => {
      // Set positions sink below every ranked tier, including 'none' — a satisfied
      // position ranks below one whose need has not even arrived yet.
      if (a.set !== b.set) return a.set ? 1 : -1;
      return NEED_TIERS.indexOf(a.tier) - NEED_TIERS.indexOf(b.tier)
        || ALL_POSITIONS.indexOf(a.position) - ALL_POSITIONS.indexOf(b.position);
    });
}

// Two spaces between entries: at 12px a single space runs "QB:1 RB:2" together.
// (.pos-counts sets white-space: pre-wrap so the run of spaces survives to the page.)
export function positionCountLine(roster) {
  const counts = countByPosition(roster);
  return ALL_POSITIONS.map((position) => `${position}:${counts[position]}`).join('  ');
}

export function renderMyTeam(container, ctx) {
  const { roster, slots, round, totalRounds, teamName } = ctx;
  clear(container);

  container.appendChild(el('h2', { text: `My Team — ${teamName}` }, []));

  for (const slot of assignSlots(roster, slots)) {
    container.appendChild(slotRow(slot));
  }

  container.appendChild(el('div', {
    class: 'pos-counts',
    text: positionCountLine(roster),
  }, []));

  const needs = el('div', { class: 'needs' }, [el('h2', { text: 'Positional Needs' }, [])]);
  for (const need of needSummary(roster, slots, round, totalRounds)) {
    // A set position is not a ranking any more, so it gets no tier chip and a
    // muted label instead of its position color (.need-row.set in styles.css).
    needs.appendChild(el('div', { class: need.set ? 'need-row set' : 'need-row' }, [
      el('span', {
        text: need.label,
        style: { color: need.set ? null : POSITION_COLORS[need.position] },
      }, []),
      need.set ? null : el('span', { class: `tier tier-${need.tier}`, text: need.tier }, []),
    ]));
  }
  container.appendChild(needs);
}
