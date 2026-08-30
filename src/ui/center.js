import { el, clear, POSITION_COLORS, formatPick } from './dom.js';
import { recommend } from '../core/recommend.js';
import { isRookie } from '../core/player.js';

export const SORT_KEYS = ['overallRank', 'position', 'vbd', 'adp'];
export const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Name or team, so typing "CIN" surfaces a quarterback and his receiver together.
// A blank query matches everything: the table shows the full pool until you type.
export function matchesQuery(player, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return player.name.toLowerCase().includes(needle)
    || player.team.toLowerCase().includes(needle);
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

// Below-replacement players are common late, so the sign has to come from the
// number rather than a hardcoded '+'. Math.round(-0.4) is -0, which formats as
// "+0" here rather than the nonsensical "-0".
export function formatVbd(vbd) {
  const rounded = Math.round(vbd);
  return rounded >= 0 ? `+${rounded}` : String(rounded);
}

// Module-level view state so a re-render keeps the user's sort/filter/search choices.
const view = { sortKey: 'overallRank', filter: 'ALL', query: '' };

function pickEntry(pool, onPick, onUndo, onOffList) {
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
    matches = input.value.trim() ? pool.filter((pl) => matchesQuery(pl, input.value)).slice(0, 8) : [];
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
    el('button', {
      text: 'Skip / off-list',
      title: 'Someone drafted a player who is not in this list — consume the pick slot',
      onClick: onOffList,
    }, []),
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
        text: `${pl.position} · ${pl.team} · #${pl.overallRank} BPA · VBD ${formatVbd(pl.vbd)}`,
      }, []),
    ]),
    el('div', {
      class: 'meta',
      text: `${pl.position} need: ${rec.need}${pl.adp === null ? '' : ` · ADP ${Math.round(pl.adp)}`}`,
    }, []),
    ...rec.reasons.map((reason) => el('div', { class: 'why', text: reason }, [])),
  ]);
}

function playerTable(tablePlayers, onPick) {
  const rows = filterByPosition(sortPlayers(tablePlayers, view.sortKey), view.filter)
    .filter((pl) => matchesQuery(pl, view.query))
    .map((pl) => {
      const taken = pl.ownerName !== null && pl.ownerName !== undefined;
      const name = el('td', { class: 'pname', title: pl.name }, [
        el('span', { text: pl.name }, []),
        isRookie(pl) ? el('span', { class: 'rookie', text: 'R' }, []) : null,
      ]);
      return el('tr', {
        class: taken ? 'taken' : '',
        // Only an available player can be drafted, and only on a double click.
        onDblclick: taken ? null : () => onPick(pl.id),
      }, [
        el('td', { text: String(pl.overallRank) }, []),
        name,
        el('td', { text: pl.position, style: { color: POSITION_COLORS[pl.position] } }, []),
        el('td', { text: pl.team }, []),
        el('td', { class: 'age', text: pl.age === null || pl.age === undefined ? '' : String(pl.age) }, []),
        el('td', { text: String(pl.projectedPoints) }, []),
        el('td', { text: String(Math.round(pl.vbd)) }, []),
        el('td', { text: pl.adp === null ? '—' : String(pl.adp) }, []),
        el('td', { text: pl.bye === null ? '—' : String(pl.bye) }, []),
        el('td', { class: 'owner', text: taken ? pl.ownerName : '' }, []),
      ]);
    });

  const header = (label, key) => el('th', {
    text: view.sortKey === key ? `${label} ▾` : label,
    onClick: key ? () => { view.sortKey = key; rerender(); } : null,
  }, []);

  return el('div', { class: 'tablewrap' }, [
    el('table', { class: 'players' }, [
      el('thead', {}, [el('tr', {}, [
        header('#', 'overallRank'), header('Player', null), header('Pos', 'position'),
        header('Tm', null), header('Age', null), header('Proj', null), header('VBD', 'vbd'),
        header('ADP', 'adp'), header('Bye', null), header('Drafted By', null),
      ])]),
      el('tbody', {}, rows),
    ]),
  ]);
}

// Set by renderCenter so the sort/filter controls can redraw without the caller's help.
let rerender = () => {};

export function renderCenter(container, ctx, handlers) {
  rerender = () => renderCenter(container, ctx, handlers);
  clear(container);

  const {
    pool, tablePlayers, needs, surplus, currentPick, nextPick, round, numTeams, isMyPick, pickingTeamName, notes,
    vbdScale,
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
    // Shown whether or not it is your pick — when it is, the wait until your next
    // turn is exactly what the current decision hangs on.
    nextPick ? el('span', {
      class: 'meta',
      text: `Your next: ${formatPick(nextPick, numTeams)} (${nextPick - currentPick} picks away)`,
    }, []) : null,
  ]));

  container.appendChild(pickEntry(pool, handlers.onPick, handlers.onUndo, handlers.onOffList));

  for (const note of notes || []) {
    container.appendChild(el('div', { class: 'notes', text: note }, []));
  }

  if (isMyPick && pool.length) {
    container.appendChild(el('h2', { text: 'Recommended' }, []));
    const recs = recommend(pool, { needs, surplus, currentPick, nextPick, round, vbdScale }, 3);
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
        if (table) table.replaceWith(playerTable(tablePlayers, handlers.onPick));
      },
    }, []),
  ]);

  container.appendChild(el('h2', { text: `Players (${pool.length} available)` }, []));
  container.appendChild(filters);
  container.appendChild(playerTable(tablePlayers, handlers.onPick));
}
