import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { boardCells, renderBoard } from '../src/ui/board.js';
import { DEFAULT_CONFIG, createState, applyPick, applyOffListPick, availablePlayers } from '../src/core/state.js';

installDomStub();

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
