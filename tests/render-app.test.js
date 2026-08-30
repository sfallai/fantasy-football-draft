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
