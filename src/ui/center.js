import { el, clear, POSITION_COLORS, formatPick } from './dom.js';
import { recommend, sleepers } from '../core/recommend.js';
import { byeConflict } from '../core/roster.js';
import { isRookie, priorSummary, matchesQuery } from '../core/player.js';
import { showPopover, closePopover } from './popover.js';
import { HANDCUFF_POSITIONS } from '../core/handcuff.js';

export const SORT_KEYS = ['overallRank', 'position', 'vbd', 'adp'];
export const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

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

export function filterByPositions(pool, positions) {
  if (!positions || positions.length === 0) return [...pool];
  return pool.filter((pl) => positions.includes(pl.position));
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
// `handcuffsOnly` defaults off: in round one you own no starters, so it would empty
// the board on a screen the user has not asked anything of yet.
const DEFAULT_VIEW = {
  sortKey: 'overallRank', positions: [], query: '', availableOnly: true, handcuffsOnly: false,
};
const view = { ...DEFAULT_VIEW };

// Module state outlives a draft, so a reset has to put it back explicitly.
export function resetView() {
  Object.assign(view, DEFAULT_VIEW);
}

export function isTaken(player) {
  return player.ownerName !== null && player.ownerName !== undefined;
}

// The rows the table will actually show, in order — also what the heading counts.
export function visiblePlayers(tablePlayers, handcuffIds = new Set()) {
  // Backlog requirement: "Filter by name, always show result but no selectable if
  // already drafted (if on team show team)". Available only is a browsing aid for
  // the unfiltered list; the moment a query narrows the pool, its matches — drafted
  // or not — must all surface, so the toggle only applies when there is no query.
  const hasQuery = view.query.trim().length > 0;
  return filterByPositions(sortPlayers(tablePlayers, view.sortKey), view.positions)
    .filter((pl) => matchesQuery(pl, view.query))
    .filter((pl) => hasQuery || !view.availableOnly || !isTaken(pl))
    // ANDed with the position buttons rather than folded into them: "my handcuffs,
    // among RBs" is the question, and a position chip cannot express it.
    .filter((pl) => !view.handcuffsOnly || handcuffIds.has(pl.id));
}

function byeWarning(player, myRoster, slots) {
  const clash = myRoster && slots ? byeConflict(player, myRoster, slots) : null;
  return clash ? el('div', { class: 'bye-warn', text: `⚠ Bye ${player.bye} — same week as your ${player.position} ${clash}` }, []) : null;
}

// A fact about what happens next, not a reason to draft him — which is why it is a line
// on the card rather than an entry in reasonsFor, whose two slots are for reasons. The
// pool passed in is already the available players, so membership is the whole check, and
// a backupId pointing outside it (common — depth charts run past the top 400) is not an
// error: the absence of the line is the message, never "no handcuff available".
//
// Running backs only, matching HANDCUFF_POSITIONS — see the reasoning there. Without
// this gate the four most-viewed cards in the shipped pool each carried a false line:
// "Handcuff available: Tee Higgins" under Ja'Marr Chase, and three more like it.
// `pool` needs no guard: recommendationCard is only reached inside `if (isMyPick &&
// pool.length)`.
function backupNote(player, pool) {
  if (!player.backupId || !HANDCUFF_POSITIONS.includes(player.position)) return null;
  const backup = pool.find((pl) => pl.id === player.backupId);
  return backup
    ? el('div', { class: 'backup-note', text: `Handcuff available: ${backup.name}` }, [])
    : null;
}

function recommendationCard(rec, myRoster, slots, pool) {
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
    byeWarning(pl, myRoster, slots),
    // The whole pool, not the position-filtered `targeted` list: whether his backup is
    // still there does not depend on which positions you happen to be looking at.
    backupNote(pl, pool),
  ]);
}

function sleeperCard(gamble, myRoster, slots) {
  const pl = gamble.player;
  return el('div', { class: 'rec sleeper', style: { borderLeftColor: POSITION_COLORS[pl.position] } }, [
    el('div', { class: 'top' }, [
      el('span', { class: 'pname' }, [
        el('span', { text: pl.name }, []),
        el('span', { class: 'gamble', text: 'GAMBLE' }, []),
      ]),
      el('span', { class: 'meta', text: `${pl.position} · ${pl.team} · #${pl.overallRank}` }, []),
    ]),
    // The same two numbers a recommendation card carries. A sleeper is the pick a user
    // is most likely to second-guess, so it must not be the one card that hides them.
    el('div', {
      class: 'meta',
      text: `VBD ${formatVbd(pl.vbd)}${pl.adp === null || pl.adp === undefined ? '' : ` · ADP ${Math.round(pl.adp)}`}`,
    }, []),
    el('div', { class: 'why', text: gamble.why }, []),
    byeWarning(pl, myRoster, slots),
  ]);
}

function playerTable(tablePlayers, onPick, handcuffIds) {
  const rows = visiblePlayers(tablePlayers, handcuffIds)
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

// A scrollport that is already at its end must not keep advertising more, so this is
// recomputed rather than set once. Exported for the test: layout is invisible to the DOM
// stub, so the arithmetic is the only part that can be pinned.
export function setScrollHint(node) {
  const more = node.scrollHeight > node.clientHeight + node.scrollTop + 1;
  node.className = more ? 'center-scroll has-more' : 'center-scroll';
  return more;
}

// Set by renderCenter so the sort/filter controls can redraw without the caller's help.
let rerender = () => {};

export function renderCenter(container, ctx, handlers) {
  rerender = () => renderCenter(container, ctx, handlers);
  closePopover();
  clear(container);

  const {
    pool, tablePlayers, needs, surplus, currentPick, nextPick, round, numTeams, isMyPick, pickingTeamName, notes,
    vbdScale, poolSize, myRoster, slots, handcuffIds = new Set(),
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

  // Everything of variable height — competitive notes, three recommendation cards each
  // possibly carrying a bye-warning line, and the sleepers — lives in its own scrollport.
  // The panel itself is `overflow: hidden` (see styles.css), so this is what absorbs a
  // long block instead of the panel scrolling the pick header off the top.
  const scroll = el('div', { class: 'center-scroll' }, []);
  container.appendChild(scroll);
  // The fade at the bottom edge is the only thing telling a user mid-draft that there
  // are more suggestions below. Recomputed on scroll as well as on render, so it stops
  // claiming there is more once you have reached the end.
  scroll.addEventListener('scroll', () => setScrollHint(scroll));

  for (const note of notes || []) {
    scroll.appendChild(el('div', { class: 'notes', text: note }, []));
  }

  if (isMyPick && pool.length) {
    // The same selection drives the table and the recommendations — one control, one
    // meaning. vbdScale and poolSize stay the whole-pool values passed in ctx, so
    // narrowing the input here cannot change what a VBD point or a rank is worth.
    const targeted = filterByPositions(pool, view.positions);
    const recs = recommend(targeted, { needs, surplus, currentPick, nextPick, round, vbdScale, poolSize }, 3);

    scroll.appendChild(el('h2', {
      text: view.positions.length ? `Recommended — ${view.positions.join(', ')}` : 'Recommended',
    }, []));
    for (const rec of recs) scroll.appendChild(recommendationCard(rec, myRoster, slots, pool));

    const gambles = sleepers(targeted, {
      currentPick,
      excludeIds: new Set(recs.map((r) => r.player.id)),
    }, 2);
    if (gambles.length) {
      scroll.appendChild(el('h2', { text: 'Sleepers' }, []));
      for (const g of gambles) scroll.appendChild(sleeperCard(g, myRoster, slots));
    }
  }

  // After the block is populated, not before — scrollHeight is meaningless until then.
  setScrollHint(scroll);

  const headingText = () =>
    `Players (${visiblePlayers(tablePlayers, handcuffIds).length} shown · ${pool.length} available)`;
  const heading = el('h2', { text: headingText() }, []);

  // Deliberately its own button rather than another position chip: chunk D turns
  // the position row into a multi-select, and folding this in would collide.
  const availableOnlyBtn = el('button', {
    class: view.availableOnly ? 'selected' : '',
    text: 'Available only',
    onClick: () => { view.availableOnly = !view.availableOnly; rerender(); },
  }, []);

  // A query overrides the toggle (see visiblePlayers), so the button should say so
  // rather than implying a filter that isn't actually happening while you search.
  function syncAvailableOnlyBtn() {
    const hasQuery = Boolean(view.query.trim());
    availableOnlyBtn.setAttribute('title', hasQuery
      ? 'Ignored while a search is active — matches are always shown, drafted or not'
      : 'Hide players who have already been drafted');
    availableOnlyBtn.style.opacity = hasQuery ? '0.6' : '';
  }
  syncAvailableOnlyBtn();

  // Its own button for the same reason Available only is: it is not a position, and
  // the position row is a multi-select whose ALL/clear semantics this would collide
  // with. ANDed with that row, so "my handcuffs, among RBs" is expressible.
  const handcuffBtn = el('button', {
    class: view.handcuffsOnly ? 'selected' : '',
    text: 'Handcuffs',
    title: 'Show only the backups to the players in your starting lineup',
    onClick: () => { view.handcuffsOnly = !view.handcuffsOnly; rerender(); },
  }, []);

  // An empty table reads as a bug. Which of the two reasons it is matters: one
  // resolves itself as you draft, the other means the board genuinely has nothing.
  function handcuffEmptyNote() {
    if (!view.handcuffsOnly || visiblePlayers(tablePlayers, handcuffIds).length > 0) return null;
    const text = handcuffIds.size === 0
      ? 'No handcuffs yet — this shows the backups to the players in your starting lineup, once you have some.'
      : 'None of your starters\' backups are still on the board.';
    return el('div', { class: 'empty-note', text }, []);
  }

  // Rebuilt rather than shown/hidden, because its text depends on the filter result.
  let emptyNote = null;
  function redrawEmptyNote() {
    if (emptyNote && emptyNote.parentNode === container) container.removeChild(emptyNote);
    emptyNote = handcuffEmptyNote();
    if (emptyNote) container.appendChild(emptyNote);
  }

  function redrawTable() {
    const wrap = container.querySelector('.tablewrap');
    if (wrap) wrap.replaceWith(playerTable(tablePlayers, handlers.onPick, handcuffIds));
    // The count is a count of what is on screen, so it moves with the table.
    heading.textContent = headingText();
    syncAvailableOnlyBtn();
    redrawEmptyNote();
  }

  const filterInput = el('input', {
    type: 'text', placeholder: 'Filter by name or team…', value: view.query, autocomplete: 'off',
    onInput: (e) => { view.query = e.target.value; redrawTable(); },
  }, []);

  const filters = el('div', { class: 'filters' }, [
    ...POSITION_FILTERS.map((position) => el('button', {
      class: position === 'ALL'
        ? (view.positions.length === 0 ? 'selected' : '')
        : (view.positions.includes(position) ? 'selected' : ''),
      text: position,
      title: position === 'ALL'
        ? 'Show every position'
        : `Target ${position} — filters the list and the recommendations`,
      // A full re-render, not redrawTable: these buttons now drive the
      // recommendations as well as the table, and a partial redraw would leave the
      // recommendations stale with no visible symptom.
      onClick: () => {
        if (position === 'ALL') view.positions = [];
        else if (view.positions.includes(position)) {
          view.positions = view.positions.filter((x) => x !== position);
        } else {
          view.positions = [...view.positions, position];
        }
        rerender();
      },
    }, [])),
    filterInput,
    el('button', { text: '✕', title: 'Clear the filter', onClick: () => { view.query = ''; rerender(); } }, []),
    availableOnlyBtn,
    handcuffBtn,
    el('button', { text: '?', title: 'What do these mean?', onClick: (e) => showPopover(glossaryPopover(), e) }, []),
  ]);

  container.appendChild(heading);
  container.appendChild(filters);
  container.appendChild(playerTable(tablePlayers, handlers.onPick, handcuffIds));
  redrawEmptyNote();

  // Focus is restored after each render so the user can filter pick after pick
  // without reaching for the mouse. preventScroll: true because focus() otherwise
  // scrolls the nearest scrollable ancestor to reveal the input — this call has no
  // business moving the viewport, whatever the layout happens to be doing.
  setTimeout(() => filterInput.focus({ preventScroll: true }), 0);
}
