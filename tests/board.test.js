import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { boardCells, renderBoard } from '../src/ui/board.js';
import { DEFAULT_CONFIG, createState, applyPick, applyOffListPick, availablePlayers } from '../src/core/state.js';

// No hand-rolled globals on top of this. installDomStub() already supplies a
// document.body that removes children and a window with viewport dimensions — and the
// stubbed-out document add/removeEventListener this file used to install destroyed the
// stub's deliberately modelled listener dedupe, so any popover-dismissal test written
// here would have passed without dismissing anything.
installDomStub();

function boardFixture() {
  const players = [
    { id: 'a', name: 'Alpha Back', position: 'RB', team: 'DET', projectedPoints: 210, overallRank: 1, bye: 6 },
    { id: 'b', name: 'Beta Wide', position: 'WR', team: 'CIN', projectedPoints: 190, overallRank: 2, bye: 9 },
  ];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  return { state, players };
}

const PLAYERS = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i + 1}`, name: `First Last${i + 1}`, team: 'XX',
  position: ['RB', 'WR', 'QB', 'TE'][i % 4],
  overallRank: i + 1, positionRank: 1, projectedPoints: 300 - i, adp: i + 1, bye: 7,
}));

// Walk the stub tree; boardCells has its own tests above, this covers the wiring
// renderBoard adds on top: the cell's onClick and the ctx.editablePool /
// ctx.onEditPick keys it reads. Nothing above this line ever called renderBoard, so
// a missing ctx key here would only throw when a real user clicked a cell.
function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

test('clicking a filled cell opens the pick editor popover', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  const container = document.createElement('div');
  renderBoard(container, {
    state,
    allPlayers: PLAYERS,
    editablePool: availablePlayers(state, PLAYERS),
    onEditPick: () => {},
  });

  const filledCell = find(container, (n) => n.tagName === 'td' && n.className.includes('cell'))[0];
  const before = document.body.children.length;
  filledCell.listeners.click[0]({ clientX: 10, clientY: 10 });
  assert.equal(document.body.children.length, before + 1, 'a popover was appended');

  const pop = document.body.children[document.body.children.length - 1];
  assert.equal(pop.className, 'pop editor');
  const text = find(pop, () => true).map((n) => n.textContent).join(' ');
  assert.match(text, /Pick 1/);
});

test('an unfilled cell has no click handler', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  const container = document.createElement('div');
  renderBoard(container, {
    state,
    allPlayers: PLAYERS,
    editablePool: availablePlayers(state, PLAYERS),
    onEditPick: () => {},
  });

  const emptyCell = find(container, (n) => n.tagName === 'td' && n.className.includes('cell'))[0];
  assert.equal((emptyCell.listeners.click || []).length, 0);
});

test('choosing a candidate in the board editor calls onEditPick with the pick and player', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  let edited = null;
  const container = document.createElement('div');
  renderBoard(container, {
    state,
    allPlayers: PLAYERS,
    editablePool: availablePlayers(state, PLAYERS),
    onEditPick: (pick, playerId) => { edited = { pick, playerId }; },
  });

  const filledCell = find(container, (n) => n.tagName === 'td' && n.className.includes('cell'))[0];
  filledCell.listeners.click[0]({ clientX: 10, clientY: 10 });

  const pop = document.body.children[document.body.children.length - 1];
  const input = find(pop, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'First Last2' } });
  find(pop, (n) => n.className === 'cand')[0].listeners.click[0]();

  assert.deepEqual(edited, { pick: 1, playerId: 'p2' });
});

test('boardCells is rounds x teams in display order', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid.length, 3);
  assert.equal(grid[0].length, 10);
  assert.deepEqual(grid[0].map((c) => c.teamIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(grid[1].map((c) => c.teamIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'display order stays left-to-right even in reversed rounds');
});

test('boardCells maps round 2 columns back to the snake pick numbers', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[1][0].pick, 20, 'team 1 picks last in round 2');
  assert.equal(grid[1][9].pick, 11, 'team 10 picks first in round 2');
});

test('boardCells attaches drafted players to their cells', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  state = applyPick(state, 'p2');
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[0][0].player.id, 'p1');
  assert.equal(grid[0][1].player.id, 'p2');
  assert.equal(grid[0][2].player, null);
});

test('boardCells flags the current pick and the user\'s column', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3, myTeamIndex: 4 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[0][0].isCurrent, true);
  assert.equal(grid[0][1].isCurrent, false);
  assert.ok(grid.every((row) => row[3].isMine), 'column 4 is mine in every round');
  assert.ok(grid.every((row) => !row[0].isMine));
});

test('boardCells marks an off-list pick as spent, not empty', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  state = applyOffListPick(state);
  const grid = boardCells(state, PLAYERS);

  assert.equal(grid[0][1].player, null, 'there is no pool player to show');
  assert.equal(grid[0][1].isOffList, true);
  assert.equal(grid[0][1].isKeeper, false);
  assert.equal(grid[0][2].isOffList, false, 'a genuinely unfilled cell is not off-list');
  assert.equal(grid[0][0].isOffList, false, 'a normal pick is not off-list');
});

test('boardCells flags keepers', () => {
  const config = {
    ...DEFAULT_CONFIG,
    rounds: 3,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 5 ? { ...t, keeper: { playerId: 'p9', round: 2 } } : t)),
  };
  const grid = boardCells(createState(config), PLAYERS);
  const cell = grid[1].find((c) => c.teamIndex === 6);
  assert.equal(cell.isKeeper, true);
  assert.equal(cell.player.id, 'p9');
});

test('only a filled cell carries the class the pointer cursor is scoped to', () => {
  // `cursor: pointer` on every cell advertised an affordance that ~145 of 150 cells
  // do not have: an unfilled cell has no click handler at all.
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  state = applyOffListPick(state);
  const container = document.createElement('div');
  renderBoard(container, {
    state, allPlayers: PLAYERS, editablePool: availablePlayers(state, PLAYERS), onEditPick: () => {},
  });

  const cells = find(container, (n) => n.tagName === 'td' && n.className.includes('cell'));
  for (const cell of cells) {
    const filled = cell.className.split(' ').includes('filled');
    assert.equal(filled, (cell.listeners.click || []).length > 0,
      'the class and the handler agree on every cell');
  }
  assert.equal(cells.filter((c) => c.className.includes('filled')).length, 2,
    'the drafted pick and the off-list pick');
});

test('each team header carries its grade', () => {
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  const grades = new Map([[1, { grade: 'A+' }], [2, { grade: 'D' }]]);
  renderBoard(container, {
    state, allPlayers: players, grades, editablePool: [], onEditPick() {},
  });
  const shown = find(container, (n) => n.className === 'team-grade').map((n) => n.textContent);
  assert.deepEqual(shown, ['A+', 'D']);
});

test('a header still shows the team name alongside the grade', () => {
  // The name and the grade are two separately styled lines, so the header is built
  // entirely from children. Pin that adding the grade did not cost the name.
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, {
    state, allPlayers: players, grades: new Map([[1, { grade: 'B' }]]),
    editablePool: [], onEditPick() {},
  });
  const header = find(container, (n) => n.tagName === 'th' && n.children.length)[0];
  const texts = header.children.map((c) => c.textContent);
  assert.ok(texts.some((t) => t.includes('Team')), 'the name survives');
  assert.ok(texts.includes('B'), 'and so does the grade');
});

test('a board with no grades supplied still renders', () => {
  // renderBoard is called before grades exist in at least one path; it must not throw.
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, { state, allPlayers: players, editablePool: [], onEditPick() {} });
  assert.equal(find(container, (n) => n.className === 'team-grade').length, 0);
});

test('the popover lists the team\'s picks as well as its slots and grade', () => {
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, {
    state, allPlayers: players, grades: new Map([[1, { grade: 'B', strength: 210 }]]),
    editablePool: [], onEditPick() {},
  });
  find(container, (n) => n.tagName === 'th' && n.children.length)[0]
    .listeners.click[0]({ clientX: 10, clientY: 10 });
  const pop = document.body.children.find((n) => (n.className || '').includes('roster-pop'));
  assert.ok(find(pop, (n) => n.className === 'pop-pick').length > 0, 'picks are listed');
  assert.ok(find(pop, (n) => n.className === 'pop-grade').length === 1, 'and the grade');
  assert.equal(find(pop, (n) => n.className === 'pop-offlist').length, 0,
    'and no off-list note when every pick resolved');
});

test('the popover says so when a team\'s picks could not all be counted', () => {
  // rosterFor drops an off-list pick, so the picks list is shorter than the team's pick
  // count and the grade treats that starting slot as empty. Silently, that reads as a
  // bug; the line is what makes it read as the deliberate zero it is.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = applyOffListPick(state); // pick 3 — round 2, team 2 in a two-team snake
  const players = [
    { id: 'a', name: 'Alpha Back', position: 'RB', team: 'DET', projectedPoints: 210, overallRank: 1, bye: 6 },
    { id: 'b', name: 'Beta Wide', position: 'WR', team: 'CIN', projectedPoints: 190, overallRank: 2, bye: 9 },
  ];
  const container = document.createElement('div');
  renderBoard(container, { state, allPlayers: players, editablePool: [], onEditPick() {} });

  const headers = find(container, (n) => n.tagName === 'th' && n.children.length);
  headers[1].listeners.click[0]({ clientX: 10, clientY: 10 });
  const pop = document.body.children.find((n) => (n.className || '').includes('roster-pop'));
  assert.equal(find(pop, (n) => n.className === 'pop-pick').length, 1, 'one countable pick');
  const note = find(pop, (n) => n.className === 'pop-offlist')[0];
  assert.ok(note, 'and the uncounted one is accounted for');
  assert.equal(note.textContent, '1 off-list pick not counted');

  // The other team lost nothing, so it says nothing.
  headers[0].listeners.click[0]({ clientX: 10, clientY: 10 });
  const mine = document.body.children.find((n) => (n.className || '').includes('roster-pop'));
  assert.equal(find(mine, (n) => n.className === 'pop-offlist').length, 0);
});
