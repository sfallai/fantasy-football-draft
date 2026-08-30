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
