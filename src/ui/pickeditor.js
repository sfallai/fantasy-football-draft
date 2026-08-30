import { el, clear } from './dom.js';
import { matchesQuery } from '../core/player.js';

// How many candidates to offer. A popover is a search surface, not a second player
// table — showing the whole pool here would be unusable and duplicate the centre panel.
const MAX_CANDIDATES = 8;

export function pickEditor(cell, pool, onCommit) {
  const list = el('div', { class: 'cand-list' }, []);

  const input = el('input', {
    type: 'text', placeholder: 'Type the right player…', autocomplete: 'off',
    onInput: (e) => {
      clear(list);
      const query = e.target.value;
      // Blank shows nothing: matchesQuery passes everything through on an empty
      // query, which would drop the entire pool into the popover.
      if (!query.trim()) return;
      for (const candidate of pool.filter((p) => matchesQuery(p, query)).slice(0, MAX_CANDIDATES)) {
        list.appendChild(el('div', {
          class: 'cand',
          text: `${candidate.name} — ${candidate.position} ${candidate.team}`,
          onClick: () => onCommit(candidate.id),
        }, []));
      }
    },
  }, []);

  return el('div', { class: 'pop editor' }, [
    el('h3', { text: `Pick ${cell.pick}` }, []),
    el('div', { class: 'meta', text: cell.player ? `Currently ${cell.player.name}` : 'Currently off-list' }, []),
    input,
    list,
  ]);
}
