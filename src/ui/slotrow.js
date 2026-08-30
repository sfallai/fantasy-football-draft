import { el, POSITION_COLORS } from './dom.js';

// Team and bye belong on the row, not in a title attribute — a tooltip you have to
// hover for is no use when you are scanning the roster for a bye-week clash on the clock.
export function playerMeta(player) {
  if (!player) return '';
  return `${player.team} · ${player.bye === null || player.bye === undefined ? 'no bye' : `bye ${player.bye}`}`;
}

export function slotRow(slot) {
  const player = slot.player;
  return el('div', { class: 'slot' }, [
    el('span', { class: 'label', text: slot.label }, []),
    el('span', {
      class: `name${player ? '' : ' empty'}`,
      text: player ? player.name : 'empty',
      style: player ? { color: POSITION_COLORS[player.position] } : {},
      title: player ? `${player.name} — ${player.position} · ${player.projectedPoints} proj` : '',
    }, []),
    player ? el('span', { class: 'meta', text: playerMeta(player) }, []) : null,
  ]);
}
