import { el, clear, POSITION_COLORS, formatPick } from './dom.js';
import { recommend } from '../core/recommend.js';
import { isRookie, priorSummary } from '../core/player.js';
import { showPopover } from './popover.js';

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
// `availableOnly` defaults on: the spec requires every player to have a row, but by
// the middle rounds most of the region you scroll is greyed noise, and renderDraft
// rebuilds the panel every pick so scroll position resets to the top each time.
const DEFAULT_VIEW = { sortKey: 'overallRank', filter: 'ALL', query: '', availableOnly: true };
const view = { ...DEFAULT_VIEW };

// Module state outlives a draft, so a reset has to put it back explicitly.
export function resetView() {
  Object.assign(view, DEFAULT_VIEW);
}

export function isTaken(player) {
  return player.ownerName !== null && player.ownerName !== undefined;
}

// The rows the table will actually show, in order — also what the heading counts.
export function visiblePlayers(tablePlayers) {
  return filterByPosition(sortPlayers(tablePlayers, view.sortKey), view.filter)
    .filter((pl) => matchesQuery(pl, view.query))
    .filter((pl) => !view.availableOnly || !isTaken(pl));
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
  const rows = visiblePlayers(tablePlayers)
    .map((pl) => {
      const taken = isTaken(pl);
      const name = el('td', {
        class: 'pname', title: pl.name,
        onClick: (e) => showPopover(playerPopover(pl), e),
      }, [
        // Before the name, not after: the badge is the row's one piece of scannable
        // colour and must never be what a long name pushes out of view.
        isRookie(pl) ? el('span', { class: 'rookie', text: 'R' }, []) : null,
        el('span', { text: pl.name }, []),
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

// The five need tiers are the ones positionalNeeds() actually produces and the
// recommendation card actually prints — not the reason-line labels, which the user
// never sees on their own.
const GLOSSARY = [
  ['BPA', 'Best player available — the raw overall ranking, ignoring what you already have.'],
  ['Proj', 'Projected fantasy points for the whole season, under this league\'s scoring.'],
  ['VBD', 'Value based drafting — points above the last starter at this position. Compares across positions.'],
  ['ADP', 'Average draft pick — where this player usually goes. Far past it is value; well before it is a reach.'],
  ['Bye', 'The week this player does not play.'],
  ['R', 'Rookie — no prior NFL season on record.'],
  ['Need', 'How much your roster wants this position right now — one of the five tiers below.'],
  ['high', 'No starter at this position yet.'],
  ['medium', 'You have one, but a starting slot at this position is still open.'],
  ['low', 'Starters are covered; only a FLEX slot could still take one.'],
  ['bench', 'Every startable slot is full — this would be bench depth.'],
  ['none', 'Not needed. K and DEF sit here until the last few rounds.'],
];

function glossaryPopover() {
  return el('div', { class: 'pop' }, [
    // Not "columns": BPA, Need and R are not columns, and the need tiers are values.
    el('h3', { text: 'What these mean' }, []),
    el('dl', {}, GLOSSARY.flatMap(([term, meaning]) => [
      el('dt', { text: term }, []),
      el('dd', { text: meaning }, []),
    ])),
  ]);
}

function playerPopover(pl) {
  const prior = priorSummary(pl);
  return el('div', { class: 'pop' }, [
    el('h3', { text: pl.name }, []),
    el('div', { text: `${pl.position} · ${pl.team} · #${pl.overallRank} overall${pl.age === null || pl.age === undefined ? '' : ` · age ${pl.age}`}` }, []),
    // The greyed row conveys "gone"; only the owner column says to whom, and the
    // popover is opened from the name cell that sits right next to it.
    isTaken(pl) ? el('div', { class: 'owner', text: `Drafted by ${pl.ownerName}` }, []) : null,
    el('div', { style: { marginTop: '8px', color: '#8b93a5' }, text: 'Last season' }, []),
    // A rookie has no prior line, and saying so is better than printing zeroes.
    el('div', { text: prior || (isRookie(pl) ? 'Rookie — no NFL season yet' : 'No prior season on record') }, []),
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

  container.appendChild(el('div', { class: 'pickbar' }, [
    el('button', { text: 'Undo', onClick: handlers.onUndo }, []),
    el('button', {
      text: 'Skip / off-list',
      title: 'Someone drafted a player who is not in this list — consume the pick slot',
      onClick: handlers.onOffList,
    }, []),
  ]));

  for (const note of notes || []) {
    container.appendChild(el('div', { class: 'notes', text: note }, []));
  }

  if (isMyPick && pool.length) {
    container.appendChild(el('h2', { text: 'Recommended' }, []));
    const recs = recommend(pool, { needs, surplus, currentPick, nextPick, round, vbdScale }, 3);
    for (const rec of recs) container.appendChild(recommendationCard(rec));
  }

  const headingText = () =>
    `Players (${visiblePlayers(tablePlayers).length} shown · ${pool.length} available)`;
  const heading = el('h2', { text: headingText() }, []);

  function redrawTable() {
    const wrap = container.querySelector('.tablewrap');
    if (wrap) wrap.replaceWith(playerTable(tablePlayers, handlers.onPick));
    // The count is a count of what is on screen, so it moves with the table.
    heading.textContent = headingText();
  }

  const filterInput = el('input', {
    type: 'text', placeholder: 'Filter by name or team…', value: view.query, autocomplete: 'off',
    onInput: (e) => { view.query = e.target.value; redrawTable(); },
  }, []);

  const filters = el('div', { class: 'filters' }, [
    ...POSITION_FILTERS.map((position) => el('button', {
      class: view.filter === position ? 'selected' : '',
      text: position,
      onClick: () => { view.filter = position; rerender(); },
    }, [])),
    filterInput,
    el('button', { text: '✕', title: 'Clear the filter', onClick: () => { view.query = ''; rerender(); } }, []),
    // Deliberately its own button rather than another position chip: chunk D turns
    // the position row into a multi-select, and folding this in would collide.
    el('button', {
      class: view.availableOnly ? 'selected' : '',
      text: 'Available only',
      title: 'Hide players who have already been drafted',
      onClick: () => { view.availableOnly = !view.availableOnly; rerender(); },
    }, []),
    el('button', { text: '?', title: 'What do these mean?', onClick: (e) => showPopover(glossaryPopover(), e) }, []),
  ]);

  container.appendChild(heading);
  container.appendChild(filters);
  container.appendChild(playerTable(tablePlayers, handlers.onPick));

  // Focus is restored after each render so the user can filter pick after pick
  // without reaching for the mouse.
  setTimeout(() => filterInput.focus(), 0);
}
