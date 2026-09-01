import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderCenter, resetView } = await import('../src/ui/center.js');
const { closePopover } = await import('../src/ui/popover.js');

const player = (over) => ({
  id: 'p1', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overallRank: 1,
  positionRank: 1, projectedPoints: 297.1, vbd: 80, adp: 1.4, bye: 6,
  age: 24, experience: 4, prior: { points: 289.9, games: 17, ppg: 17.1 },
  ownerName: null, ...over,
});

function ctx(tablePlayers) {
  return {
    pool: tablePlayers.filter((pl) => !pl.ownerName),
    tablePlayers,
    needs: {}, surplus: {}, currentPick: 1, nextPick: 4,
    round: 1, numTeams: 10, isMyPick: false, pickingTeamName: 'Team 1',
    notes: [], vbdScale: 100,
  };
}

// `view` is module state that survives between renders on purpose, so each test
// starts from the documented defaults.
function render(tablePlayers) {
  resetView();
  const container = document.createElement('div');
  renderCenter(container, ctx(tablePlayers), { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

// Walk the stub tree, since it models only a one-hit querySelector.
function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

const button = (container, label) =>
  find(container, (n) => n.tagName === 'button' && n.textContent === label)[0];
const bodyRows = (container) =>
  find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));

// Drafted players are hidden by default now, so the tests about them say so.
function showEveryone(container) {
  button(container, 'Available only').listeners.click[0]();
}

test('the table lists drafted players as well as available ones', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  showEveryone(container);
  assert.equal(bodyRows(container).length, 2, 'a drafted player still gets a row');
});

test('a drafted row is marked taken and names the owner', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  showEveryone(container);
  const taken = find(container, (n) => n.className === 'taken');
  assert.equal(taken.length, 1);
  const owner = find(container, (n) => n.className === 'owner');
  assert.equal(owner[0].textContent, 'Team 3');
});

test('an undrafted row is not marked taken and shows no owner', () => {
  const container = render([player()]);
  assert.equal(find(container, (n) => n.className === 'taken').length, 0);
  assert.equal(find(container, (n) => n.className === 'owner')[0].textContent, '');
});

test('a drafted row cannot be double-clicked into a pick', () => {
  // The guard that stops you re-drafting someone already gone.
  const container = render([player({ ownerName: 'Team 3' })]);
  showEveryone(container);
  const taken = find(container, (n) => n.className === 'taken')[0];
  assert.equal((taken.listeners.dblclick || []).length, 0);
});

test('an available row commits a pick on double-click, not on a single click', () => {
  let picked = null;
  resetView();
  const container = document.createElement('div');
  renderCenter(container, ctx([player()]), {
    onPick: (id) => { picked = id; }, onUndo() {}, onOffList() {},
  });
  const row = bodyRows(container)[0];
  assert.equal((row.listeners.click || []).length, 0, 'a stray click must never burn a pick');
  row.listeners.dblclick[0]();
  assert.equal(picked, 'p1');
});

test('a rookie is badged and a veteran is not', () => {
  const rookieContainer = render([player({ experience: 0, prior: null })]);
  assert.equal(find(rookieContainer, (n) => n.className === 'rookie').length, 1);
  const vetContainer = render([player()]);
  assert.equal(find(vetContainer, (n) => n.className === 'rookie').length, 0);
});

test('the rookie badge sits before the name, where nothing can clip it', () => {
  const container = render([player({ experience: 0, prior: null })]);
  const cell = find(container, (n) => n.className === 'pname')[0];
  assert.equal(cell.children[0].className, 'rookie');
  assert.equal(cell.children[1].textContent, 'Jahmyr Gibbs');
});

test('age renders, and is blank for a defense', () => {
  const container = render([player({ age: 24 }), player({ id: 'd', age: null, position: 'DEF' })]);
  const cells = find(container, (n) => n.className === 'age');
  assert.deepEqual(cells.map((c) => c.textContent), ['24', '']);
});

test('the pick-entry box is gone and the filter is the only text input', () => {
  const container = render([player()]);
  const inputs = find(container, (n) => n.tagName === 'input');
  assert.equal(inputs.length, 1, 'one text input, not two');
  assert.equal(inputs[0].attributes.placeholder, 'Filter by name or team…');
});

test('Undo and Skip survive the removal of the pick box', () => {
  const container = render([player()]);
  const labels = find(container, (n) => n.tagName === 'button').map((b) => b.textContent);
  assert.ok(labels.includes('Undo'));
  assert.ok(labels.includes('Skip / off-list'));
});

test('typing in the filter narrows the table', () => {
  const container = render([player(), player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' })]);
  assert.equal(bodyRows(container).length, 2);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'only the matching player is left');
  assert.ok(find(rows[0], (n) => n.textContent === 'Bijan Robinson').length);
});

test('the clear button empties the filter', () => {
  const container = render([player(), player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' })]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  assert.equal(bodyRows(container).length, 1);

  button(container, '✕').listeners.click[0]();

  const reRendered = find(container, (n) => n.tagName === 'input')[0];
  assert.equal(reRendered.attributes.value, '', 'the filter box comes back empty');
  assert.equal(bodyRows(container).length, 2, 'and every player is listed again');
});

test('a re-render replaces the panel rather than appending a second copy', () => {
  // dom.js's clear() is what makes this true; the stub models firstChild/removeChild
  // so a render path that forgot to clear would show up here.
  const container = render([player()]);
  const before = container.children.length;
  button(container, '✕').listeners.click[0]();
  assert.equal(container.children.length, before);
  assert.equal(find(container, (n) => n.tagName === 'table').length, 1);
});

test('the heading counts what is shown as well as what is available', () => {
  const container = render([
    player(),
    player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' }),
    player({ id: 'p3', name: 'Taken Guy', ownerName: 'Team 3' }),
  ]);
  const heading = find(container, (n) => n.tagName === 'h2' && n.textContent.startsWith('Players'))[0];
  assert.equal(heading.textContent, 'Players (2 shown · 2 available)');

  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  assert.equal(heading.textContent, 'Players (1 shown · 2 available)', 'the count follows the table');
});

test('Available only is on by default and hides drafted players', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const toggle = button(container, 'Available only');
  assert.equal(toggle.className, 'selected', 'it starts on');
  assert.equal(bodyRows(container).length, 1, 'the drafted player is hidden');

  toggle.listeners.click[0]();
  assert.equal(button(container, 'Available only').className, '', 'toggling turns it off');
  assert.equal(bodyRows(container).length, 2, 'and the drafted player comes back');
});

// Backlog: "Filter by name, always show result but no selectable if already
// drafted (if on team show team)". Available only must govern browsing only —
// an active query overrides it so a search never comes back empty just because
// the match happens to be drafted.
test('Available only hides a drafted player when there is no query', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  assert.equal(button(container, 'Available only').className, 'selected', 'on by default');
  assert.equal(bodyRows(container).length, 1, 'the drafted player has no row');
});

test('a query overrides Available only and surfaces a matching drafted player', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Taken' } });

  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'the drafted player has a row despite the toggle being on');
  assert.equal(rows[0].className, 'taken', 'and it is marked taken');
  assert.equal((rows[0].listeners.dblclick || []).length, 0, 'so it cannot be double-clicked into a pick');
  const owner = find(rows[0], (n) => n.className === 'owner')[0];
  assert.equal(owner.textContent, 'Team 3', 'and it names the owning team');
});

test('a query still hides drafted players that do not match it', () => {
  const container = render([
    player({ name: 'Available Guy' }),
    player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' }),
  ]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Available' } });

  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'only the match is shown');
  assert.ok(find(rows[0], (n) => n.textContent === 'Available Guy').length);
});

test('the glossary button is present and opens on click', () => {
  const container = render([player()]);
  const help = button(container, '?');
  assert.ok(help);

  const before = document.body.children.length;
  help.listeners.click[0]({ clientX: 40, clientY: 60 });
  assert.equal(document.body.children.length, before + 1, 'a popover was appended');

  const pop = document.body.children[document.body.children.length - 1];
  assert.equal(pop.className, 'pop');
  const terms = find(pop, (n) => n.tagName === 'dt').map((n) => n.textContent);
  // Every need tier the recommendation card can actually print must be defined,
  // and no tier the app never shows may be.
  for (const term of ['BPA', 'Proj', 'VBD', 'ADP', 'Bye', 'R', 'Need', 'high', 'medium', 'low', 'bench', 'none']) {
    assert.ok(terms.includes(term), `the glossary defines ${term}`);
  }
  assert.ok(!terms.includes('depth'), 'no tier the app never shows');
  assert.ok(!terms.includes('not needed'), 'no tier the app never shows');
  closePopover();
});

test('a player name is clickable for detail', () => {
  const container = render([player()]);
  const nameCell = find(container, (n) => n.className === 'pname')[0];

  const before = document.body.children.length;
  nameCell.listeners.click[0]({ clientX: 100, clientY: 120 });
  assert.equal(document.body.children.length, before + 1);

  const pop = document.body.children[document.body.children.length - 1];
  assert.equal(pop.className, 'pop');
  const lines = find(pop, () => true).map((n) => n.textContent);
  assert.ok(lines.includes('Jahmyr Gibbs'), 'the popover names the player');
  assert.ok(lines.some((t) => t.includes('RB · DET · #1 overall')), 'and summarises him');
  assert.ok(lines.some((t) => t.includes('289.9 pts in 17 games')), 'and shows last season');
  closePopover();
});

test('the detail popover names the owner of a drafted player', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  showEveryone(container);
  const nameCell = find(container, (n) => n.className === 'pname')[0];
  nameCell.listeners.click[0]({ clientX: 100, clientY: 120 });

  const pop = document.body.children[document.body.children.length - 1];
  const lines = find(pop, () => true).map((n) => n.textContent);
  assert.ok(lines.includes('Drafted by Team 3'), 'the one fact the greyed row was conveying');
  closePopover();
});

// Correction: the spec requires the filter input to stay keyboard-first — focused
// after every render — now that pickEntry (which used to own that focus call) is gone.
test('the filter input is focused after a render', async () => {
  const container = render([player()]);
  const inputs = find(container, (n) => n.tagName === 'input');
  assert.equal(inputs.length, 1);
  // The focus call is deferred (setTimeout 0), same as pickEntry's used to be.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inputs[0].focused, true);
});

// Correction A: `view.positions` is module state that survives between tests (the
// `render()` helper above resets it, but these tests build ctx by hand), so each of
// these three starts with an explicit resetView() the same way `render()` does.

test('recommendations are restricted to the targeted positions', () => {
  resetView();
  const pool = [
    player({ id: 'wr', name: 'A Receiver', position: 'WR', overallRank: 2 }),
    player({ id: 'rb', name: 'A Back', position: 'RB', overallRank: 1 }),
  ];
  const container = document.createElement('div');
  renderCenter(container, { ...ctx(pool), pool, isMyPick: true, needs: { WR: 'high', RB: 'high' } },
    { onPick() {}, onUndo() {}, onOffList() {} });
  // Drive the WR button through its real handler.
  const wrBtn = find(container, (n) => n.tagName === 'button' && n.textContent === 'WR')[0];
  wrBtn.listeners.click[0]();
  // Correction A: the original fixture searched `document.body || container` — since
  // document.body always exists by this point, that search never actually looked at
  // container and the assertion below was vacuous. Search container.
  const names = find(container, (n) => n.className === 'pname').map((n) => n.textContent);
  assert.ok(!names.includes('A Back'), 'an untargeted position cannot be recommended');
});

// Correction B: the original fixture used a single-player pool, so that player was
// both the sole top-3 recommendation (landing in excludeIds) and the only possible
// sleeper — an assertion that could never pass. Three higher-ranked players (ADP
// pinned to the current pick, so they cannot qualify as fallers themselves) fill the
// top 3 and get excluded, leaving the actual faller as the only sleeper candidate.
// Ranks 1, 2, 3, 40 are sparse enough that nobody has the 3 band-neighbours
// projectionEdge() needs, so only the ADP path can qualify anyone.
test('a sleeper renders in its own list, marked as a gamble', () => {
  resetView();
  const currentPick = 40;
  const top = [
    player({ id: 't1', name: 'Top One', overallRank: 1, adp: currentPick }),
    player({ id: 't2', name: 'Top Two', overallRank: 2, adp: currentPick }),
    player({ id: 't3', name: 'Top Three', overallRank: 3, adp: currentPick }),
  ];
  const faller = player({ id: 'f', name: 'Falling Guy', overallRank: 40, adp: 5 });
  const pool = [...top, faller];
  const container = document.createElement('div');
  renderCenter(container, { ...ctx(pool), pool, isMyPick: true, currentPick },
    { onPick() {}, onUndo() {}, onOffList() {} });
  const gambles = find(container, (n) => n.className === 'gamble');
  assert.equal(gambles.length, 1);
  assert.equal(gambles[0].textContent, 'GAMBLE');
});

test('a candidate sharing a bye with a same-position starter is flagged', () => {
  resetView();
  const cand = player({ id: 'c', name: 'Clash', position: 'RB', bye: 9 });
  const starter = { id: 's', name: 'My Back', position: 'RB', bye: 9, projectedPoints: 250, team: 'XX' };
  const container = document.createElement('div');
  renderCenter(container, {
    ...ctx([cand]), pool: [cand], isMyPick: true, needs: { RB: 'high' },
    myRoster: [starter], slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 },
  }, { onPick() {}, onUndo() {}, onOffList() {} });
  const warn = find(container, (n) => n.className === 'bye-warn');
  assert.equal(warn.length, 1);
  assert.match(warn[0].textContent, /My Back/);
});

test('re-rendering the panel closes an open popover', () => {
  // A stale popover would point at DOM the re-render has already replaced — harmless
  // for a read-only detail card, not harmless for chunk E's pick editor.
  // Builds its ctx by hand like the three tests above, so it needs their resetView():
  // a position filter left set by an earlier test would empty the table and there
  // would be no .pname to click.
  resetView();
  const container = document.createElement('div');
  const draw = () => renderCenter(container, ctx([player()]), { onPick() {}, onUndo() {}, onOffList() {} });
  draw();
  find(container, (n) => n.className === 'pname')[0].listeners.click[0]({ clientX: 10, clientY: 10 });
  assert.equal(document.body.children.filter((n) => n.className.includes('pop')).length, 1);
  draw();
  assert.equal(document.body.children.filter((n) => n.className.includes('pop')).length, 0);
});

// --- Handcuffs -------------------------------------------------------------------
// `view.handcuffsOnly` is module-private with no setter, so every test below drives
// the real button, exactly the way the `Available only` tests above do.

// Extends the `player()` fixture rather than replacing it: Gibbs is the starter you
// own, Pacheco is his backup, Jameson is a backup at another position — which is what
// makes the AND with the position buttons observable.
// The owned player is deliberate: without one, tablePlayers.length and pool.length are
// equal, and the case-4 assertion on "this list of N players" cannot tell which of the
// two the sentence is counting.
const handcuffPool = () => [
  player(),
  player({ id: 'pacheco', name: 'Isiah Pacheco', team: 'KC', position: 'RB', overallRank: 40 }),
  player({ id: 'jamo', name: 'Jameson Williams', team: 'DET', position: 'WR', overallRank: 41 }),
  player({ id: 'gone', name: 'Already Drafted', team: 'NYJ', position: 'RB', overallRank: 42, ownerName: 'Team 3' }),
];

function renderWithHandcuffs(tablePlayers, handcuffIds) {
  resetView();
  const container = document.createElement('div');
  renderCenter(container, { ...ctx(tablePlayers), handcuffIds },
    { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

// A `.pname` cell holds a span per fragment (an optional rookie badge, then the name),
// and the stub's textContent is empty on any node with children — so the name lives on
// the last span, not on the cell.
const shownNames = (container) => find(container, (n) => n.className === 'pname')
  .map((cell) => cell.children[cell.children.length - 1].textContent);

test('the handcuff button filters the table to your starters\' backups', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco']));
  assert.deepEqual(shownNames(container).sort(),
    ['Isiah Pacheco', 'Jahmyr Gibbs', 'Jameson Williams'], 'off by default');

  button(container, 'Handcuffs').listeners.click[0]();
  assert.deepEqual(shownNames(container), ['Isiah Pacheco']);
  assert.equal(button(container, 'Handcuffs').className, 'selected', 'and the button says it is on');

  button(container, 'Handcuffs').listeners.click[0]();
  assert.equal(shownNames(container).length, 3, 'toggling it back off restores the board');
});

test('the handcuff filter is ANDed with the position buttons', () => {
  // "My handcuffs, among RBs" is the question, and a position chip cannot express it.
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco', 'jamo']));
  button(container, 'RB').listeners.click[0]();
  button(container, 'Handcuffs').listeners.click[0]();
  assert.deepEqual(shownNames(container), ['Isiah Pacheco'],
    'a WR handcuff must not survive an RB filter');
});

test('the heading count follows the handcuff filter, like the table does', () => {
  // Three call sites read visiblePlayers, one of them the count. A missed one shows a
  // number that disagrees with the rows underneath it.
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco']));
  button(container, 'Handcuffs').listeners.click[0]();
  const heading = find(container, (n) => n.tagName === 'h2' && n.textContent.startsWith('Players'))[0];
  assert.equal(heading.textContent, 'Players (1 shown · 3 available)');
});

test('the handcuff button says why the list is empty rather than showing nothing', () => {
  // Round one: you own no starters, so the button correctly finds nothing. An empty
  // table would read as a broken button.
  const container = renderWithHandcuffs(handcuffPool(), new Set());
  button(container, 'Handcuffs').listeners.click[0]();
  assert.equal(bodyRows(container).length, 0);
  const note = find(container, (n) => n.className === 'empty-note');
  assert.equal(note.length, 1, 'the empty table is explained');
  assert.match(note[0].textContent, /starting lineup/i, 'and names the reason: no starters yet');
});

test('the empty note tells "none yet" apart from "their backups are gone"', () => {
  // The two cases resolve differently: one fixes itself as you draft, the other means
  // the board genuinely has nothing left to show.
  const pool = handcuffPool();
  pool[1] = { ...pool[1], ownerName: 'Team 3' };
  const container = renderWithHandcuffs(pool, new Set(['pacheco']));
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.ok(note, 'the empty table is explained here too');
  assert.match(note.textContent, /still on the board/i);
});

// The variant has to be decided against the unfiltered available pool, not against the
// fully-filtered rows. Deciding it on the rows made every other active filter — a
// position chip, a search box — claim your handcuffs had been drafted, which is false
// and sends you to look for a replacement you do not need.
test('a position filter hiding your handcuff does not claim he is gone', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco']));
  button(container, 'QB').listeners.click[0]();
  button(container, 'Handcuffs').listeners.click[0]();
  assert.equal(bodyRows(container).length, 0);
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.ok(note, 'the empty table is still explained');
  assert.doesNotMatch(note.textContent, /still on the board/i,
    'Pacheco is on the board — the QB button is what is hiding him');
  assert.match(note.textContent, /hiding/i);
  assert.match(note.textContent, /\b1\b/, 'and says how many are being hidden');
});

test('a search box hiding your handcuff does not claim he is gone either', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco']));
  const input = find(container, (n) => n.tagName === 'input')[0];
  button(container, 'Handcuffs').listeners.click[0]();
  input.listeners.input[0]({ target: { value: 'zzzz' } });
  assert.equal(bodyRows(container).length, 0);
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.ok(note, 'the empty table is still explained');
  assert.doesNotMatch(note.textContent, /still on the board/i);
  assert.match(note.textContent, /hiding/i);
});

// 121 of the 309 shipped backupIds point outside the 400-player pool — Josh Allen's,
// for one. "Nobody took him" and "he was never in this app" are different absences and
// resolve differently, so the copy must not conflate them.
test('the empty note says running backs, because that is what the filter covers', () => {
  // A lineup of five with no RB is an ordinary round-six state. Saying "the players in
  // your starting lineup" tells that user they have no starters, which is false — and
  // is the same species of untrue on-screen sentence the RB restriction removed.
  const container = renderWithHandcuffs(handcuffPool(), new Set());
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.match(note.textContent, /running back/i);
});

test('one backup outside the list reads as one, not as several', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['deep-reserve']));
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.match(note.textContent, /That backup is/, 'singular for a single-RB lineup');
  assert.doesNotMatch(note.textContent, /Those backups/);
});

test('two backups outside the list read as several', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['deep-reserve', 'deeper-reserve']));
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.match(note.textContent, /Those backups are/);
});

test('a backup who is not in the list at all is not reported as drafted', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['deep-reserve']));
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.ok(note);
  assert.doesNotMatch(note.textContent, /still on the board/i,
    'he was never on the board — nobody drafted him');
  assert.match(note.textContent, /not draftable here/i);
  // The list, not the available pool — handcuffPool() has an owned player precisely so
  // those two numbers differ and `${pool.length}` cannot satisfy this.
  assert.match(note.textContent, /\b4\b/, 'and names the size of the list he is outside');
});

// The stub has no layout engine, so it can only pin WHERE in the tree the note goes —
// which is the whole fix. Appended to the flex column instead, it rendered at the very
// bottom of the panel with an empty table grown above it, and on a short viewport it
// was the first thing to shrink and then got clipped by .panel.center's overflow.
// Only a browser can confirm the visual result.
test('the empty note renders inside the table scrollport, where the rows would be', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set());
  button(container, 'Handcuffs').listeners.click[0]();
  const note = find(container, (n) => n.className === 'empty-note')[0];
  assert.ok(note, 'the note is rendered');
  assert.equal(note.parentNode.className, 'tablewrap',
    'not appended to the panel below the table it replaces');
});

test('the empty note is gone once the filter has something to show', () => {
  const container = renderWithHandcuffs(handcuffPool(), new Set(['pacheco']));
  button(container, 'Handcuffs').listeners.click[0]();
  assert.equal(find(container, (n) => n.className === 'empty-note').length, 0);
});

// A recommendation carries a line when the player's own backup is still on the board:
// a fact about what happens next, not a reason to draft him, which is why it lives on
// the card rather than in reasonsFor's two slots. `pool` in ctx is already the
// available players, so its membership is the whole test.
const BACKED_UP_STARTER = player({ backupId: 'pacheco' });
const THE_BACKUP = player({
  id: 'pacheco', name: 'Isiah Pacheco', team: 'KC', position: 'RB', overallRank: 40,
});

// recommend() takes the top three, so a pool this small puts every fixture on a card —
// the assertions below are then about the note, not about which player came back.
// `over` is spread last so a test can move the pick numbers, the roster or the needs
// without rebuilding the whole ctx by hand.
function renderRecs(pool, over = {}) {
  resetView();
  const container = document.createElement('div');
  renderCenter(container, { ...ctx(pool), pool, isMyPick: true, needs: { RB: 'high' }, ...over },
    { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

const recCards = (container) => find(container, (n) => n.className === 'rec');

test('a recommendation says when the player\'s own backup is still available', () => {
  // The useful direction: it tells you the insurance exists before you spend the pick.
  const container = renderRecs([BACKED_UP_STARTER, THE_BACKUP]);
  const cards = recCards(container);
  assert.equal(cards.length, 2, 'both fixtures are recommended');

  const noted = cards.filter((card) => find(card, (n) => n.className === 'backup-note').length);
  assert.equal(noted.length, 1, 'only the player who has a backup gets the line');
  // The card's .pname span holds the name directly, unlike the table cell's.
  assert.equal(find(noted[0], (n) => n.className === 'pname')[0].textContent, 'Jahmyr Gibbs');
  assert.match(find(noted[0], (n) => n.className === 'backup-note')[0].textContent, /Isiah Pacheco/);
});

test('no line when the backup has already gone', () => {
  const container = renderRecs([BACKED_UP_STARTER]);
  assert.equal(recCards(container).length, 1, 'he is still recommended');
  assert.equal(find(container, (n) => n.className === 'backup-note').length, 0,
    'omit rather than say "no backup available"');
});

test('a wide receiver gets no handcuff line, however available his WR2 is', () => {
  // The WR2 is a starter in his own right, not the man who inherits the workload —
  // this is exactly the false line the shipped pool put under Ja'Marr Chase.
  const container = renderRecs([
    player({ id: 'chase', name: 'Ja\'Marr Chase', team: 'CIN', position: 'WR', backupId: 'higgins' }),
    player({ id: 'higgins', name: 'Tee Higgins', team: 'CIN', position: 'WR', overallRank: 45 }),
  ]);
  assert.equal(recCards(container).length, 2, 'both are still recommended');
  assert.equal(find(container, (n) => n.className === 'backup-note').length, 0);
});

test('a quarterback gets no handcuff line either', () => {
  const container = renderRecs([
    player({ id: 'allen', name: 'Josh Allen', team: 'BUF', position: 'QB', backupId: 'trubisky' }),
    player({ id: 'trubisky', name: 'Mitch Trubisky', team: 'BUF', position: 'QB', overallRank: 200 }),
  ]);
  assert.equal(find(container, (n) => n.className === 'backup-note').length, 0);
});

test('a backup outside the pool is not an error, it is simply no line', () => {
  // backupId routinely points past the top 400, and both consumers handle it by omission.
  const container = renderRecs([player({ backupId: 'somebody-unranked' })]);
  assert.equal(recCards(container).length, 1);
  assert.equal(find(container, (n) => n.className === 'backup-note').length, 0);
});

// --- Availability odds, and stacks -----------------------------------------------
// Two more secondary lines on the card, and neither is a reason: one says what happens
// to this player between now and your next turn, the other states a shared NFL team.

// The stub leaves textContent empty on any node that has children, so the odds line —
// a band span plus an evidence span — has no text of its own. Every assertion about
// what is ON SCREEN therefore walks the subtree and joins it.
const allText = (node) => find(node, () => true).map((n) => n.textContent).join(' ');

// currentPick 8 → nextPick 15 against ADP 12.4 ± 6 lands at p ≈ 0.458: the middle band,
// which is the one that most obviously must not be printed as a number.
// adpStdev 6.4, not 6: an integer makes Math.round a no-op, and removing the round
// survived the whole suite. Real spreads are 10.1, 5.9, 22.4 — the rounding is live.
const LASTS = () => player({ adp: 12.4, adpStdev: 6.4, adpDrafts: 118, adpLatest: 40 });
const AT_PICK_8 = { currentPick: 8, nextPick: 15 };

test('a recommendation says how likely the player is to last', () => {
  // The band, and the inputs under it, so the claim is auditable and obviously a model.
  const container = renderRecs([LASTS()], AT_PICK_8);
  const notes = find(container, (n) => n.className === 'odds-note');
  assert.equal(notes.length, 1, 'the one recommendation carries one odds line');

  const band = find(notes[0], (n) => n.className === 'odds-band');
  assert.equal(band.length, 1, 'the band is its own element, so it can be weighted');
  // The pick is INSIDE the bolded band, not stranded at the end of the evidence.
  // "Almost certainly gone" alone is present tense about a player visibly on the board,
  // and the bolded fragment is what a reader under a draft clock takes in.
  assert.equal(band[0].textContent, 'Coin flip by 2.05');

  const text = allText(notes[0]);
  // One string, not two loose fragments: /ADP 12 ± 6/ alone matches "± 6.4" as a prefix,
  // so dropping the Math.round on the spread survived it.
  assert.match(text, /ADP 12 ± 6 across 118 drafts/,
    'the inputs under the band, rounded, so the reading is auditable');
  // Round.pick, never a bare overall number: the header two inches above says "Your
  // next: 2.05", and this line used to say "15" for the same pick.
  assert.doesNotMatch(text, /\bat 15\b/, 'no bare overall pick number anywhere');
});

test('a spread under half a pick reads as one, never as zero', () => {
  // Rounds to 0 and prints "± 0" — visual certainty from a model that refuses a spread
  // of exactly 0 as no information. No shipped player is under 0.5 today (the minimum is
  // 0.6), but the pool is regenerated daily.
  const container = renderRecs([player({ adp: 3.2, adpStdev: 0.4, adpDrafts: 900, adpLatest: 40 })],
    { currentPick: 2, nextPick: 9 });
  const text = allText(find(container, (n) => n.className === 'odds-note')[0]);
  assert.match(text, /± 1\b/);
  assert.doesNotMatch(text, /± 0\b/);
});

test('no odds line when the model refuses to answer', () => {
  // No spread is no information. Omit rather than say "unknown".
  const container = renderRecs([player({ adp: 12.4, adpStdev: null, adpDrafts: 118 })], AT_PICK_8);
  assert.equal(recCards(container).length, 1, 'he is still recommended');
  assert.equal(find(container, (n) => n.className === 'odds-note').length, 0);
});

test('no odds line for a player already past anything ever observed', () => {
  // The second refusal: past adpLatest the model is extrapolating into the tail it is
  // measurably worst in, so it declines rather than asserting into it.
  const container = renderRecs([player({ adp: 12.4, adpStdev: 6, adpDrafts: 118, adpLatest: 40 })],
    { currentPick: 41, nextPick: 48 });
  assert.equal(recCards(container).length, 1);
  assert.equal(find(container, (n) => n.className === 'odds-note').length, 0);
});

test('no percentage appears anywhere on the screen', () => {
  // The measured reason for bands: real ADP tails run 11-34% wider than a normal, so a
  // number looks most authoritative exactly where the model is worst.
  const container = renderRecs([LASTS()], AT_PICK_8);
  const text = allText(container);
  assert.match(text, /Coin flip/, 'the odds line is on screen at all');
  assert.doesNotMatch(text, /\d+\s?%/);
});

// A quarterback and a receiver on the same NFL team, in the direction the card sees
// most: the candidate is the QB, the pass-catcher is already yours.
const MY_CHASE = {
  id: 'chase', name: 'Ja\'Marr Chase', team: 'CIN', position: 'WR', bye: 10, projectedPoints: 262,
};
const SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 };

test('a stack is stated as a shared team, never as advice', () => {
  const burrow = player({
    id: 'burrow', name: 'Joe Burrow', team: 'CIN', position: 'QB', overallRank: 20, bye: 10,
  });
  const container = renderRecs([burrow],
    { needs: { QB: 'high' }, myRoster: [MY_CHASE], slots: SLOTS });

  const notes = find(container, (n) => n.className === 'stack-note');
  assert.equal(notes.length, 1, 'the shared team is stated');
  const text = notes[0].textContent;
  assert.match(text, /same NFL team/i);
  assert.match(text, /Ja'Marr Chase/, 'and names the team-mate you already own');
  assert.match(text, /WR/, 'and what he plays');
  // Whether a stack is GOOD in a season-long non-PPR league is a judgement this data
  // cannot support. Scoped to the line itself — the panel's own heading is
  // "Recommended", and that word is not this line's to avoid.
  assert.doesNotMatch(text, /pairs well|good fit|recommended/i);
});

test('no stack line when nothing on your roster shares his team', () => {
  // Gibbs is DET; the quarterback you own is not. Omission is the message.
  const container = renderRecs([player()], {
    myRoster: [{ id: 'mah', name: 'Patrick Mahomes', team: 'KC', position: 'QB', bye: 10, projectedPoints: 380 }],
    slots: SLOTS,
  });
  assert.equal(recCards(container).length, 1);
  assert.equal(find(container, (n) => n.className === 'stack-note').length, 0);
});
