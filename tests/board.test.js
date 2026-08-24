import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardCells } from '../src/ui/board.js';
import { DEFAULT_CONFIG, createState, applyPick, applyOffListPick } from '../src/core/state.js';

const PLAYERS = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i + 1}`, name: `First Last${i + 1}`, team: 'XX',
  position: ['RB', 'WR', 'QB', 'TE'][i % 4],
  overallRank: i + 1, positionRank: 1, projectedPoints: 300 - i, adp: i + 1, bye: 7,
}));

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
