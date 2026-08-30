import { el, clear } from './dom.js';
import { matchesQuery } from '../core/player.js';
import { OFF_LIST_PREFIX } from '../core/state.js';

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

      // The player already in this cell is the one thing choosing cannot change.
      const matches = pool.filter((p) => matchesQuery(p, query) && p.draftedAt !== cell.pick);

      for (const candidate of matches.slice(0, MAX_CANDIDATES)) {
        // A player who already sits at another pick is offered, not hidden —
        // committing him exchanges the two picks. Say so on the row: an exchange the
        // user did not ask for would be a nasty surprise on draft day.
        const label = candidate.draftedAt
          ? `${candidate.name} — swap with pick ${candidate.draftedAt}`
          : `${candidate.name} — ${candidate.position} ${candidate.team}`;
        list.appendChild(el('div', {
          class: 'cand',
          text: label,
          onClick: () => onCommit(candidate.id),
        }, []));
      }

      // The pool is in overall-rank order, so silent truncation can push a
      // low-ranked target off the end with no hint that he is there at all.
      if (matches.length > MAX_CANDIDATES) {
        list.appendChild(el('div', {
          class: 'cand-more',
          text: `${matches.length - MAX_CANDIDATES} more — keep typing to narrow this list`,
        }, []));
      }
    },
  }, []);

  // Skip / off-list only ever fires at the pick on the clock (applyOffListPick reads
  // currentPickNumber), so this is the only way to say that an EARLIER pick went to
  // someone who is not in the pool. It fills the cell with the same sentinel rather
  // than emptying it, so the clock is untouched.
  const offList = el('div', {
    class: 'cand offlist',
    text: 'Unknown / off-list — not in this pool',
    onClick: () => onCommit(`${OFF_LIST_PREFIX}${cell.pick}`),
  }, []);

  // Typing is the entire interaction, so the input must be live the moment the
  // popover opens. Deferred because showPopover appends this node after we return it,
  // and preventScroll: true because focus() otherwise scrolls the board — the same
  // reason the centre panel's filter box defers.
  setTimeout(() => input.focus({ preventScroll: true }), 0);

  return el('div', { class: 'pop editor' }, [
    el('h3', { text: `Pick ${cell.pick}` }, []),
    el('div', { class: 'meta', text: cell.player ? `Currently ${cell.player.name}` : 'Currently off-list' }, []),
    input,
    list,
    offList,
  ]);
}
