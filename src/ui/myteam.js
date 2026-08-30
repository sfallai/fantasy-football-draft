import { el, clear, POSITION_COLORS } from './dom.js';
import { assignSlots, positionalNeeds, countByPosition, ALL_POSITIONS, NEED_TIERS, LATE_ROUND_WINDOW } from '../core/roster.js';
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
  if (have >= required && required > 0) {
    return position === 'QB' || position === 'TE'
      ? `${position} set — depth only`
      : 'FLEX / bench depth';
  }
  return 'FLEX / bench depth';
}

export function needSummary(roster, slots, round, totalRounds) {
  const needs = positionalNeeds(roster, slots, round, totalRounds);
  const counts = countByPosition(roster);

  return ALL_POSITIONS
    .map((position) => ({
      position,
      tier: needs[position],
      // 'bench' means every startable slot at this position is full, so another
      // player there cannot enter the lineup. It stays in the list as a
      // confirmation — "QB set" — but is no longer a ranked need. The tier itself
      // stays in positionalNeeds because scorePlayer uses it to devalue surplus picks.
      set: needs[position] === 'bench',
      label: needLabel(position, needs[position], counts[position], slots[position] || 0, totalRounds),
    }))
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
