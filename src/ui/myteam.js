import { el, clear, POSITION_COLORS } from './dom.js';
import {
  assignSlots, positionalNeeds, countByPosition, ALL_POSITIONS, NEED_TIERS, LATE_ROUND_WINDOW,
} from '../core/roster.js';

function needLabel(position, tier, have, required, totalRounds) {
  if (position === 'K' || position === 'DEF') {
    if (tier === 'none' && have >= required) return `${position} set`;
    if (tier === 'none') return `wait until round ${totalRounds - LATE_ROUND_WINDOW + 1}`;
    return `${position} needed`;
  }
  if (tier === 'high') return required > 1 ? `${position}1 needed` : `${position} needed`;
  if (tier === 'medium') return `${position}${have + 1} needed`;
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
      label: needLabel(position, needs[position], counts[position], slots[position] || 0, totalRounds),
    }))
    .sort((a, b) => NEED_TIERS.indexOf(a.tier) - NEED_TIERS.indexOf(b.tier)
      || ALL_POSITIONS.indexOf(a.position) - ALL_POSITIONS.indexOf(b.position));
}

export function renderMyTeam(container, ctx) {
  const { roster, slots, round, totalRounds, teamName } = ctx;
  clear(container);

  container.appendChild(el('h2', { text: `My Team — ${teamName}` }, []));

  for (const slot of assignSlots(roster, slots)) {
    const player = slot.player;
    container.appendChild(el('div', { class: 'slot' }, [
      el('span', { class: 'label', text: slot.label }, []),
      el('span', {
        class: `name${player ? '' : ' empty'}`,
        text: player ? `${player.name} (${player.team})` : 'empty',
        style: player ? { color: POSITION_COLORS[player.position] } : {},
        title: player ? `${player.position} · ${player.projectedPoints} proj · bye ${player.bye ?? '—'}` : '',
      }, []),
    ]));
  }

  const needs = el('div', { class: 'needs' }, [el('h2', { text: 'Positional Needs' }, [])]);
  for (const need of needSummary(roster, slots, round, totalRounds)) {
    needs.appendChild(el('div', { class: 'need-row' }, [
      el('span', {
        text: need.label,
        style: { color: POSITION_COLORS[need.position] },
      }, []),
      el('span', { class: `tier tier-${need.tier}`, text: need.tier }, []),
    ]));
  }
  container.appendChild(needs);
}
