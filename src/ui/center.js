import { el, clear, POSITION_COLORS, formatPick } from './dom.js';
import { recommend } from '../core/recommend.js';

export const SORT_KEYS = ['overallRank', 'position', 'vbd', 'adp'];
export const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export function searchPlayers(pool, query, limit = 8) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return pool
    .filter((pl) => pl.name.toLowerCase().includes(needle) || pl.team.toLowerCase().includes(needle))
    .sort((a, b) => a.overallRank - b.overallRank)
    .slice(0, limit);
}

export function sortPlayers(pool, key) {
  const copy = [...pool];
  if (key === 'vbd') return copy.sort((a, b) => b.vbd - a.vbd);
  if (key === 'adp') {
    return copy.sort((a, b) => {
      if (a.adp === null && b.adp === null) return a.overallRank - b.overallRank;
      if (a.adp === null) return 1;
      if (b.adp === null) return -1;
      return a.adp - b.adp;
    });
  }
  if (key === 'position') {
    return copy.sort((a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
      || a.overallRank - b.overallRank);
  }
  return copy.sort((a, b) => a.overallRank - b.overallRank);
}

export function filterByPosition(pool, position) {
  return position === 'ALL' ? [...pool] : pool.filter((pl) => pl.position === position);
}

// Module-level view state so a re-render keeps the user's sort/filter/search choices.
const view = { sortKey: 'overallRank', filter: 'ALL', query: '' };

function pickEntry(pool, onPick, onUndo) {
  const input = el('input', {
    type: 'text', placeholder: 'Type a player name, then Enter…', autocomplete: 'off',
  }, []);
  const list = el('div', { class: 'suggest-list', style: { display: 'none' } }, []);
  let matches = [];
  let active = 0;

  function close() {
    list.style.display = 'none';
    clear(list);
    matches = [];
    active = 0;
  }

  function draw() {
    clear(list);
    matches.forEach((pl, i) => {
      list.appendChild(el('div', {
        class: i === active ? 'active' : '',
        text: `${pl.name} — ${pl.position} ${pl.team} (#${pl.overallRank})`,
        onMousedown: (e) => { e.preventDefault(); onPick(pl.id); close(); input.value = ''; },
      }, []));
    });
    list.style.display = matches.length ? 'block' : 'none';
  }

  input.addEventListener('input', () => {
    matches = searchPlayers(pool, input.value);
    active = 0;
    draw();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[active]) {
      onPick(matches[active].id);
      input.value = '';
      close();
      e.preventDefault();
    } else if (e.key === 'Escape') close();
  });

  const wrap = el('div', { class: 'pickbar' }, [
    el('div', { class: 'suggest', style: { flex: '1' } }, [input, list]),
    el('button', { text: 'Undo', onClick: onUndo }, []),
  ]);

  // Focus is restored after each render so the user can type pick after pick without reaching for the mouse.
  setTimeout(() => input.focus(), 0);
  return wrap;
}

function recommendationCard(rec) {
  const pl = rec.player;
  return el('div', {
    class: 'rec',
    style: { borderLeftColor: POSITION_COLORS[pl.position] },
  }, [
    el('div', { class: 'top' }, [
      el('span', { class: 'pname', text: `${pl.name}` }, []),
      el('span', {
        class: 'meta',
        text: `${pl.position} · ${pl.team} · #${pl.overallRank} BPA · VBD +${Math.round(pl.vbd)}`,
      }, []),
    ]),
    el('div', { class: 'meta', text: `${pl.position} need: ${rec.need}${pl.adp === null ? '' : ` · ADP ${pl.adp}`}` }, []),
    ...rec.reasons.map((reason) => el('div', { class: 'why', text: reason }, [])),
  ]);
}

function playerTable(pool, onPick) {
  const rows = filterByPosition(sortPlayers(pool, view.sortKey), view.filter)
    .filter((pl) => !view.query || pl.name.toLowerCase().includes(view.query.toLowerCase()))
    .slice(0, 250)
    .map((pl) => el('tr', { onDblclick: () => onPick(pl.id) }, [
      el('td', { text: String(pl.overallRank) }, []),
      el('td', { text: pl.name }, []),
      el('td', { text: pl.position, style: { color: POSITION_COLORS[pl.position] } }, []),
      el('td', { text: pl.team }, []),
      el('td', { text: String(pl.projectedPoints) }, []),
      el('td', { text: String(Math.round(pl.vbd)) }, []),
      el('td', { text: pl.adp === null ? '—' : String(pl.adp) }, []),
      el('td', { text: pl.bye === null ? '—' : String(pl.bye) }, []),
    ]));

  const header = (label, key) => el('th', {
    text: view.sortKey === key ? `${label} ▾` : label,
    onClick: key ? () => { view.sortKey = key; rerender(); } : null,
  }, []);

  return el('table', { class: 'players' }, [
    el('thead', {}, [el('tr', {}, [
      header('#', 'overallRank'), header('Player', null), header('Pos', 'position'),
      header('Tm', null), header('Proj', null), header('VBD', 'vbd'),
      header('ADP', 'adp'), header('Bye', null),
    ])]),
    el('tbody', {}, rows),
  ]);
}

// Set by renderCenter so the sort/filter controls can redraw without the caller's help.
let rerender = () => {};

export function renderCenter(container, ctx, handlers) {
  rerender = () => renderCenter(container, ctx, handlers);
  clear(container);

  const {
    pool, needs, currentPick, nextPick, round, numTeams, isMyPick, pickingTeamName, notes,
  } = ctx;

  container.appendChild(el('div', { class: 'pick-info' }, [
    el('span', {
      class: 'round',
      text: currentPick === null ? 'Draft complete' : `Round ${round} · Pick ${formatPick(currentPick, numTeams)}`,
    }, []),
    el('span', {
      class: `who${isMyPick ? ' mine' : ''}`,
      text: currentPick === null ? ''
        : isMyPick ? 'YOUR PICK' : `${pickingTeamName} is on the clock`,
    }, []),
    !isMyPick && nextPick ? el('span', {
      class: 'meta',
      text: `Your next: ${formatPick(nextPick, numTeams)} (${nextPick - currentPick} picks away)`,
    }, []) : null,
  ]));

  container.appendChild(pickEntry(pool, handlers.onPick, handlers.onUndo));

  for (const note of notes || []) {
    container.appendChild(el('div', { class: 'notes', text: note }, []));
  }

  if (isMyPick && pool.length) {
    container.appendChild(el('h2', { text: 'Recommended' }, []));
    const recs = recommend(pool, { needs, currentPick, nextPick, round }, 3);
    for (const rec of recs) container.appendChild(recommendationCard(rec));
  }

  const filters = el('div', { class: 'filters' }, [
    ...POSITION_FILTERS.map((position) => el('button', {
      class: view.filter === position ? 'selected' : '',
      text: position,
      onClick: () => { view.filter = position; rerender(); },
    }, [])),
    el('input', {
      type: 'text', placeholder: 'filter list…', value: view.query,
      onInput: (e) => {
        view.query = e.target.value;
        const table = container.querySelector('table.players');
        if (table) table.replaceWith(playerTable(pool, handlers.onPick));
      },
    }, []),
  ]);

  container.appendChild(el('h2', { text: `Available (${pool.length})` }, []));
  container.appendChild(filters);
  container.appendChild(playerTable(pool, handlers.onPick));
}
