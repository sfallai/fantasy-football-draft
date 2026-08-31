// The only test that exercises src/ui/app.js — the module that wires the three
// panels to the state functions. Between two tasks of chunk C the whole suite was
// green while the app would not have rendered at all: renderCenter grew a required
// ctx.tablePlayers and app.js was not passing it. Nothing below reaches into a
// panel's internals; it drives the app the way a user does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { createState, serialize, STORAGE_KEY } from '../src/core/state.js';

const PLAYERS = [
  { id: 'p1', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overallRank: 1, positionRank: 1, projectedPoints: 297.1, adp: 1.4, bye: 6, age: 24, experience: 4, prior: { points: 289.9, games: 17, ppg: 17.1 } },
  { id: 'p2', name: 'Ja Marr Chase', team: 'CIN', position: 'WR', overallRank: 2, positionRank: 1, projectedPoints: 288.4, adp: 2.1, bye: 10, age: 25, experience: 5, prior: { points: 280.1, games: 17, ppg: 16.5 } },
  { id: 'p3', name: 'Bijan Robinson', team: 'ATL', position: 'RB', overallRank: 3, positionRank: 2, projectedPoints: 271.0, adp: 3.5, bye: 5, age: 23, experience: 3, prior: { points: 265.0, games: 17, ppg: 15.6 } },
  // The rookie: experience 0 with no prior season is exactly what badges the row.
  { id: 'p4', name: 'Rookie Runner', team: 'LV', position: 'RB', overallRank: 4, positionRank: 3, projectedPoints: 210.5, adp: 20.0, bye: 8, age: 21, experience: 0, prior: null },
  { id: 'p5', name: 'Josh Allen', team: 'BUF', position: 'QB', overallRank: 5, positionRank: 1, projectedPoints: 380.2, adp: 15.0, bye: 12, age: 29, experience: 8, prior: { points: 375.0, games: 17, ppg: 22.1 } },
  { id: 'p6', name: 'Veteran Wideout', team: 'SEA', position: 'WR', overallRank: 6, positionRank: 2, projectedPoints: 198.0, adp: 30.0, bye: 9, age: 30, experience: 9, prior: { points: 190.0, games: 16, ppg: 11.9 } },
  { id: 'p7', name: 'Trey Tight', team: 'KC', position: 'TE', overallRank: 7, positionRank: 1, projectedPoints: 180.0, adp: 40.0, bye: 7, age: 27, experience: 6, prior: { points: 175.0, games: 17, ppg: 10.3 } },
  { id: 'p8', name: 'Backup Back', team: 'NYJ', position: 'RB', overallRank: 8, positionRank: 4, projectedPoints: 150.0, adp: null, bye: 11, age: 26, experience: 5, prior: { points: 140.0, games: 15, ppg: 9.3 } },
];

const CONFIG = {
  numTeams: 2,
  rounds: 3,
  myTeamIndex: 1,
  slots: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, K: 0, DEF: 0, BENCH: 1 },
  teams: [{ name: 'My Team' }, { name: 'Rival' }],
};

const document = installDomStub();

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => { stored.set(key, String(value)); },
  removeItem: (key) => { stored.delete(key); },
};

const alerts = [];
Object.assign(globalThis.window, {
  PLAYERS,
  alert: (message) => alerts.push(message),
  confirm: () => true,
});

const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);

// app.js only self-starts in the browser, so importing it here renders nothing and
// the test decides when init() runs.
const { init } = await import('../src/ui/app.js');
const { resetView } = await import('../src/ui/center.js');
const { SETUP_STEPS, DRAFT_STEPS } = await import('../src/ui/tour.js');

function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

function panels() {
  const layout = find(appRoot, (n) => n.className === 'layout')[0];
  assert.ok(layout, 'the draft view rendered three panels');
  const [left, center, right] = layout.children;
  return { left, center, right };
}

function rowFor(center, name) {
  return find(center, (n) => n.tagName === 'tr'
    && find(n, (c) => c.textContent === name).length > 0)[0];
}

const button = (node, label) =>
  find(node, (n) => n.tagName === 'button' && n.textContent === label)[0];

// The DOM stub has no layout engine, so flattening a whole subtree into one string lets
// a fact rendered in section A satisfy an assertion aimed at section B. Same guard
// render-report.test.js uses: pick the section out by its heading first.
function sectionText(node, heading) {
  const found = find(node, (n) => n.className === 'rep-section'
    && (n.children[0] || {}).textContent === heading)[0];
  assert.ok(found, `no section headed "${heading}"`);
  return find(found, () => true).map((n) => n.textContent || '').join(' ');
}

// A saved draft skips the setup screen, which has its own tests.
function start() {
  stored.clear();
  alerts.length = 0;
  resetView();
  stored.set(STORAGE_KEY, serialize(createState(CONFIG)));
  init();
}

test('init renders the three panels from a saved draft', () => {
  start();
  const { left, center, right } = panels();
  assert.ok(find(left, (n) => n.textContent === 'My Team — My Team').length, 'my roster panel');
  assert.ok(find(center, (n) => n.tagName === 'table' && n.className === 'players').length, 'the player table');
  assert.ok(find(right, (n) => n.textContent === 'Draft Board').length, 'the board');
  // One row per player, drafted-hidden default notwithstanding: nothing is drafted yet.
  const rows = find(center, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));
  assert.equal(rows.length, PLAYERS.length);
});

test('a rookie in the pool is badged and a veteran is not', () => {
  start();
  const { center } = panels();
  const badged = find(center, (n) => n.className === 'rookie');
  assert.equal(badged.length, 1, 'exactly the one rookie in the fixture');
  const rookieRow = rowFor(center, 'Rookie Runner');
  assert.ok(find(rookieRow, (n) => n.className === 'rookie').length, 'and it is his row');
});

test('double-clicking a row drafts the player, all the way through to the board', () => {
  start();
  const row = rowFor(panels().center, 'Jahmyr Gibbs');
  assert.equal((row.listeners.click || []).length, 0, 'a single click never burns a pick');
  row.listeners.dblclick[0]();
  assert.deepEqual(alerts, [], 'the pick was accepted');

  // Everything below reads the *re-rendered* tree: handlePick renders a new draft view.
  const { center, right } = panels();

  // Drafted players are hidden by default, so the greyed row only appears once the
  // Available only toggle is off — and then it carries the owner.
  assert.equal(rowFor(center, 'Jahmyr Gibbs'), undefined, 'he is out of the available list');
  button(center, 'Available only').listeners.click[0]();

  const taken = rowFor(panels().center, 'Jahmyr Gibbs');
  assert.ok(taken, 'and back in view with drafted players shown');
  assert.equal(taken.className, 'taken');
  assert.equal(find(taken, (n) => n.className === 'owner')[0].textContent, 'My Team');
  assert.equal((taken.listeners.dblclick || []).length, 0, 'he cannot be drafted twice');

  const cells = find(right, (n) => n.className && n.className.includes('cell'));
  assert.ok(cells.some((c) => c.textContent === 'J. Gibbs'), 'the board cell shows the pick');

  // And the draft moved on to the other team.
  assert.ok(find(panels().center, (n) => n.textContent === 'Rival is on the clock').length);
});

test('the pick survives a reload, and Undo takes it back', () => {
  start();
  rowFor(panels().center, 'Jahmyr Gibbs').listeners.dblclick[0]();

  // A fresh init() reads the same localStorage the pick was persisted to.
  init();
  button(panels().center, 'Available only').listeners.click[0]();
  assert.equal(rowFor(panels().center, 'Jahmyr Gibbs').className, 'taken', 'the pick persisted');

  button(panels().center, 'Undo').listeners.click[0]();
  const restored = rowFor(panels().center, 'Jahmyr Gibbs');
  assert.equal(restored.className, '', 'undo puts him back in the pool');
  assert.ok(restored.listeners.dblclick.length, 'and makes him draftable again');
});

test('Skip / off-list burns the pick slot without drafting anyone', () => {
  start();
  button(panels().center, 'Skip / off-list').listeners.click[0]();
  const { center, right } = panels();
  assert.ok(find(center, (n) => n.textContent === 'Rival is on the clock').length, 'the clock moved');
  const rows = find(center, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));
  assert.equal(rows.length, PLAYERS.length, 'nobody left the pool');
  const cells = find(right, (n) => n.className && n.className.includes('cell'));
  assert.ok(cells.some((c) => c.textContent === '—'), 'the board shows a spent slot');
});

test('Reset draft clears the saved state and returns to setup', () => {
  start();
  rowFor(panels().center, 'Jahmyr Gibbs').listeners.dblclick[0]();
  button(panels().left, 'Reset draft').listeners.click[0]();

  assert.equal(stored.get(STORAGE_KEY), undefined, 'the saved draft is gone');
  assert.equal(find(appRoot, (n) => n.className === 'layout').length, 0, 'the draft view is gone');
  assert.ok(find(appRoot, (n) => n.tagName === 'button' && n.textContent === 'Start Draft').length,
    'and the setup screen is back');
});

test('a reset also resets the centre panel view state', () => {
  start();
  // Turn the Available only default off, then reset: the next draft must not
  // inherit it — `view` is module state that outlives the draft.
  button(panels().center, 'Available only').listeners.click[0]();
  assert.equal(button(panels().center, 'Available only').className, '');

  button(panels().left, 'Reset draft').listeners.click[0]();
  stored.set(STORAGE_KEY, serialize(createState(CONFIG)));
  init();
  assert.equal(button(panels().center, 'Available only').className, 'selected');
});

// ---- Backup and import -------------------------------------------------------
// handleBackup's download cannot be driven from here (Blob, URL and a synthetic
// click on an <a>), but everything an import does after the bytes are read can:
// applyRestoredState is that half, extracted so it has a seam.

const { applyRestoredState } = await import('../src/ui/app.js');
const { deserialize } = await import('../src/core/state.js');

// A four-team league — deliberately a different shape from CONFIG, because the VBD
// baselines are derived from numTeams and slots and an import that failed to
// recompute them would keep scoring the imported draft against the old league.
const IMPORTED = {
  version: 1,
  config: {
    numTeams: 4,
    rounds: 4,
    myTeamIndex: 2,
    slots: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, K: 0, DEF: 0, BENCH: 1 },
    teams: [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }, { name: 'Delta' }],
  },
  picks: {},
  history: [],
};

// Columns: #, Player, Pos, Tm, Age, Proj, VBD, ADP, Bye, Drafted By.
const vbdCellFor = (center, name) => rowFor(center, name).children[6].textContent;

test('an import recomputes the VBD baselines for the league it brought with it', () => {
  start();
  // Two teams, one RB slot: replacement is the 2nd-best RB (271.0), so Gibbs is +26.
  assert.equal(vbdCellFor(panels().center, 'Jahmyr Gibbs'), '26');

  applyRestoredState(deserialize(JSON.stringify(IMPORTED)));

  // Four teams, one RB slot: replacement drops to the 4th-best RB (150.0).
  assert.equal(vbdCellFor(panels().center, 'Jahmyr Gibbs'), '147',
    'scored against the imported league, not the one it replaced');
  assert.ok(find(panels().left, (n) => n.textContent === 'My Team — Bravo').length,
    'and the imported draft position is in force');
});

test('an import resets the centre panel view state', () => {
  // The spec requires resetView() here for the same reason handleReset calls it:
  // sort, filter, query and position targeting are module state that outlives a draft.
  start();
  button(panels().center, 'Available only').listeners.click[0]();
  assert.equal(button(panels().center, 'Available only').className, '');

  applyRestoredState(deserialize(JSON.stringify(IMPORTED)));
  assert.equal(button(panels().center, 'Available only').className, 'selected');
});

test('an import that cannot render never reaches storage', () => {
  // Persisting first was how a malformed backup bricked the app: the bad state was
  // written, renderDraft threw, and every reload after it threw before any UI
  // existed — Reset included. Rendering first means storage only ever holds a state
  // that has already rendered once.
  start();
  const good = stored.get(STORAGE_KEY);
  assert.throws(() => applyRestoredState({
    config: { ...CONFIG, teams: null }, picks: {}, history: [],
  }));
  assert.equal(stored.get(STORAGE_KEY), good, 'the saved draft is untouched');
});

test('a saved draft that cannot render falls back to setup instead of a dead page', () => {
  // deserialize validates the config, but not every byte of every pick. This is the
  // last line: whatever gets past it, the user still lands somewhere they can act.
  start();
  stored.set(STORAGE_KEY, JSON.stringify({
    version: 1, config: CONFIG, picks: { 1: null }, history: [],
  }));
  alerts.length = 0;
  init();

  assert.equal(find(appRoot, (n) => n.className === 'layout').length, 0, 'no half-rendered draft');
  assert.ok(find(appRoot, (n) => n.tagName === 'button' && n.textContent === 'Start Draft').length,
    'the setup screen is reachable');
  assert.equal(stored.get(STORAGE_KEY), undefined, 'and the state that broke it is gone');
  assert.equal(alerts.length, 1, 'the user is told why');
});

test('the setup screen offers Import, because that is where a lost draft lands', () => {
  // Wiped storage, a different browser, a different laptop: every catastrophe a
  // backup exists for puts the user here, not on the draft screen.
  start();
  button(panels().left, 'Reset draft').listeners.click[0]();
  const importButton = find(appRoot, (n) => n.tagName === 'button' && n.textContent === 'Import backup')[0];
  assert.ok(importButton, 'the setup screen has an Import control');
  assert.ok(find(appRoot, (n) => n.attributes.type === 'file').length, 'wired to a file input');
});

// ---- Editing -----------------------------------------------------------------

function openEditor(index) {
  const { right } = panels();
  const cells = find(right, (n) => n.tagName === 'td' && String(n.className).includes('filled'));
  cells[index].listeners.click[0]({ clientX: 10, clientY: 10 });
  return document.body.children[document.body.children.length - 1];
}

function cellTexts() {
  return find(panels().right, (n) => n.tagName === 'td' && String(n.className).includes('filled'))
    .map((n) => n.textContent);
}

test('two picks logged in the wrong order are exchanged from the board editor', () => {
  // The swap case: before this, neither cell offered the other cell's player and
  // setPick threw `already drafted`. Fixing it needed a dance through a throwaway.
  start();
  rowFor(panels().center, 'Jahmyr Gibbs').listeners.dblclick[0]();
  rowFor(panels().center, 'Ja Marr Chase').listeners.dblclick[0]();
  assert.deepEqual(cellTexts(), ['J. Gibbs', 'J. Marr Chase']);

  const pop = openEditor(0);
  const input = find(pop, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Chase' } });
  const cand = find(pop, (n) => n.className === 'cand')[0];
  assert.match(cand.textContent, /swap with pick 2/, 'the editor names the exchange');
  cand.listeners.click[0]();

  assert.deepEqual(alerts, [], 'no `already drafted` rejection');
  assert.deepEqual(cellTexts(), ['J. Marr Chase', 'J. Gibbs'], 'both cells moved');

  // Both picks kept their manager: pick 1 is mine, pick 2 is the rival's.
  button(panels().center, 'Available only').listeners.click[0]();
  const owner = (name) => find(rowFor(panels().center, name), (n) => n.className === 'owner')[0].textContent;
  assert.equal(owner('Ja Marr Chase'), 'My Team');
  assert.equal(owner('Jahmyr Gibbs'), 'Rival');

  // And one Undo reverses the whole exchange, not half of it.
  button(panels().center, 'Undo').listeners.click[0]();
  assert.deepEqual(cellTexts(), ['J. Gibbs', 'J. Marr Chase']);
  assert.equal(owner('Jahmyr Gibbs'), 'My Team');
  assert.equal(owner('Ja Marr Chase'), 'Rival');
});

// Both call sites are pinned deliberately with start()/stored.clear() rather than
// relying on whatever screen a preceding test happened to leave behind — that used to
// mean this always exercised renderDraft, never showSetup, and reordering an earlier
// test could silently flip which one ran with no test noticing.
test('the page says how fresh its player data is, on the draft screen', () => {
  start();
  window.DATA_FETCHED_AT = '2026-08-30T11:00:00.000Z';
  init();
  const { right } = panels();
  const line = find(right, (n) => n.className === 'freshness')[0];
  assert.ok(line, 'the stamp renders inside the right-hand panel, under the board');
  assert.match(line.textContent, /30 Aug/);
});

test('the page says how fresh its player data is, on the setup screen', () => {
  stored.clear();
  window.DATA_FETCHED_AT = '2026-08-30T11:00:00.000Z';
  init();
  const line = find(appRoot, (n) => n.className === 'freshness')[0];
  assert.ok(line, 'the stamp renders on setup too');
  assert.match(line.textContent, /30 Aug/);
});

test('a page built without a stamp shows no freshness line at all', () => {
  // Better silence than "Player data as of Invalid Date". Covers the draft screen;
  // showSetup shares the same early-return in appendFreshness.
  start();
  window.DATA_FETCHED_AT = null;
  init();
  assert.equal(find(document.body, (n) => n.className === 'freshness').length, 0);
});

// ---- Grades and the summary --------------------------------------------------
// Both of these pin wiring, which is the only thing this file exists for. Deleting
// `grades,` from app.js's renderBoard ctx made every grade vanish from the live board,
// and deleting the End draft button made the summary unreachable — and the whole suite
// stayed green through either. board.test.js and summary.test.js render those two
// components directly; nothing but this file renders the app that has to reach them.

test('the board header carries each team\'s grade', () => {
  start();
  const gradesOf = () => find(panels().right, (n) => n.className === 'team-grade')
    .map((n) => n.textContent);

  assert.equal(gradesOf().length, CONFIG.numTeams, 'one grade per team column');
  assert.deepEqual(gradesOf(), ['C+', 'C+'], 'nobody has picked, so nobody is ahead');

  // Josh Allen is the only starter in the league, and the QB slot is one of two the
  // fixture starts — so the grades have to move apart, and in the right direction.
  rowFor(panels().center, 'Josh Allen').listeners.dblclick[0]();
  const after = gradesOf();
  assert.match(after[0], /^A/, 'the team that drafted him');
  assert.match(after[1], /^D/, 'the team that has nobody');
});

test('End draft ranks every team, and Back to draft returns to the board', () => {
  window.DATA_FETCHED_AT = '2026-08-30T11:00:00.000Z';
  start();
  rowFor(panels().center, 'Josh Allen').listeners.dblclick[0]();
  button(panels().left, 'End draft').listeners.click[0]();

  assert.equal(find(appRoot, (n) => n.className === 'layout').length, 0,
    'the summary replaces the three panels rather than overlaying them');
  const rows = find(appRoot, (n) => String(n.className).includes('sum-row'));
  assert.equal(rows.length, CONFIG.teams.length, 'one row per team');
  assert.ok(find(appRoot, (n) => n.className === 'freshness').length,
    'and it says how fresh the projections behind the ranking are');

  // The report itself, not just the ranking. Deleting `report` from showSummary's ctx
  // left 406/406 non-build tests green: summary.test.js renders renderSummary *given* a
  // report, and nothing drove the app as far as building one.
  const report = find(appRoot, (n) => n.className === 'report')[0];
  assert.ok(report, 'the report renders below the ranking');

  // And a real fact under a real heading, measured against the app's own replacement
  // levels. Passing `{}` in place of `replacement` also left the suite green, and it
  // would measure the blind spot against a bar of 0 and report every undrafted player:
  // this same line becomes "4 startable RBs ... above the replacement level of 0.0".
  // The 2-team fixture puts the RB baseline on Bijan Robinson at 271.0, so Gibbs is the
  // one man above it.
  assert.match(sectionText(report, 'Where the league was wrong'),
    /1 startable RB went undrafted — anyone projecting above the replacement level of 271\.0\. The best still there is Jahmyr Gibbs, at 297\.1\./);

  find(appRoot, (n) => n.tagName === 'button' && n.textContent === 'Back to draft')[0]
    .listeners.click[0]();
  assert.ok(find(panels().right, (n) => n.textContent === 'Draft Board').length,
    'and the draft is still there to go back to');
});

test('a reload never reopens the summary the last session was left on', () => {
  // `screen` is module state that outlives a draft, exactly like the centre panel's view.
  start();
  button(panels().left, 'End draft').listeners.click[0]();
  assert.ok(find(appRoot, (n) => String(n.className).includes('sum-row')).length);

  init();
  assert.ok(find(panels().right, (n) => n.textContent === 'Draft Board').length,
    'a fresh load opens the draft');
});

test('an earlier pick can be marked off-list from the board editor', () => {
  // applyOffListPick only fires at the clock, so once pick 2 exists there was no way
  // to say pick 1 went to someone outside the pool. The cell stays filled.
  start();
  rowFor(panels().center, 'Jahmyr Gibbs').listeners.dblclick[0]();
  rowFor(panels().center, 'Ja Marr Chase').listeners.dblclick[0]();

  const pop = openEditor(0);
  find(pop, (n) => String(n.className).includes('offlist'))[0].listeners.click[0]();

  assert.deepEqual(alerts, []);
  assert.deepEqual(cellTexts(), ['—', 'J. Marr Chase'], 'spent, not empty');
  // Pick 3 in a two-team snake is the rival's — exactly where the clock was before
  // the edit. Marking pick 1 off-list did not move it.
  assert.ok(find(panels().center, (n) => n.textContent === 'Rival is on the clock').length,
    'and the clock has not moved back');
  assert.ok(rowFor(panels().center, 'Jahmyr Gibbs'), 'Gibbs is back in the pool');
});

test('the draft screen panels are individually addressable', () => {
  // The tour anchors steps to selectors. Three panels sharing one class gives it
  // nothing to point at.
  stored.clear(); resetView();
  stored.set(STORAGE_KEY, serialize(createState(CONFIG)));
  init();
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel left').length, 1);
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel center').length, 1);
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel right').length, 1);
});

// --- Guided tour wiring. The tour is driven from app.js, so this is the only file
// that can see it start, close and re-render the screen underneath it. ---

const tourLayers = () => find(document.body, (n) => String(n.className) === 'tour-layer');

function freshSetup() {
  stored.clear();
  resetView();
  init();
}

test('changing screen closes a tour that described the screen you left', () => {
  // Draft step 6 rings End draft, and .tour-layer is pointer-events: none so the
  // click lands. Without closeTour() in render() the summary screen would come up
  // under a stale ring at the old button's coordinates, over a card reading 6 of 6.
  start();
  button(panels().left, 'Show me around').listeners.click[0]();
  assert.equal(tourLayers().length, 1, 'the draft tour is up');
  button(panels().left, 'End draft').listeners.click[0]();
  assert.equal(tourLayers().length, 0, 'and gone with the screen it described');
});

test('Reset draft closes the tour that pointed at it', () => {
  // Step 4 rings .panel.left and its copy now names reset explicitly, so this is the
  // button a first-timer is most likely to press mid-tour. handleReset() used to call
  // showSetup() directly, which skipped the closeTour() that lives in render().
  start();
  button(panels().left, 'Show me around').listeners.click[0]();
  // The card lives on document.body, not in the panel it points at.
  for (let i = 0; i < 3; i += 1) button(document.body, 'Next').listeners.click[0]();
  assert.match(find(document.body, (n) => n.className === 'tour-count')[0].textContent, /4 of 6/,
    'on the step that rings the panel the reset button sits in');
  button(panels().left, 'Reset draft').listeners.click[0]();
  assert.equal(tourLayers().length, 0, 'no stale 4 of 6 card over the setup screen');
});

test('finishing the setup tour clears the offer without recursing', () => {
  // close() runs onClose, which re-renders, which calls closeTour() again. If the
  // live handle were not cleared before the callback this blows the stack.
  freshSetup();
  assert.equal(find(appRoot, (n) => n.className === 'tour-offer').length, 1,
    'a first-time visitor is offered the tour');
  button(appRoot, 'Show me around').listeners.click[0]();
  find(document.body, (n) => String(n.className) === 'tour-skip')[0].listeners.click[0]();
  assert.equal(tourLayers().length, 0);
  assert.equal(find(appRoot, (n) => n.className === 'tour-offer').length, 0,
    'the line goes as soon as the tour ends, not on the next visit');
});

test('the offer line can be dismissed, and never comes back', () => {
  freshSetup();
  const dismiss = find(appRoot, (n) => String(n.className) === 'btn-dismiss')[0];
  assert.ok(dismiss, 'the offer carries a dismiss control');
  assert.equal(dismiss.attributes['aria-label'], 'Dismiss', 'the glyph says nothing on its own');
  dismiss.listeners.click[0]();
  assert.equal(find(appRoot, (n) => n.className === 'tour-offer').length, 0, 'gone immediately');
  assert.equal(tourLayers().length, 0, 'and dismissing never starts the tour');
  init();
  assert.equal(find(appRoot, (n) => n.className === 'tour-offer').length, 0, 'and on the next visit');
});

test('every tour anchor resolves against the screen it describes', () => {
  // Anchor resolution is otherwise invisible: rename .btn-end-draft, table.board,
  // .center-scroll or a data-tour value and the tour rings nothing at all while the
  // suite stays green. Iterated over the exported arrays, not a hard-coded list, so
  // a step added later is covered the day it lands.
  freshSetup();
  for (const step of SETUP_STEPS) {
    assert.ok(document.querySelector(step.anchor), `setup step "${step.title}" anchors to ${step.anchor}`);
  }

  start();
  for (const step of DRAFT_STEPS) {
    assert.ok(document.querySelector(step.anchor), `draft step "${step.title}" anchors to ${step.anchor}`);
  }
});
