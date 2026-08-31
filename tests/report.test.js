import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stillOnWaivers, pickValues, biggestSteals, biggestReaches,
  WAIVER_POSITIONS, WAIVERS_PER_POSITION,
} from '../src/core/report.js';
import { createState, applyPick, applyOffListPick } from '../src/core/state.js';

const pl = (id, position, points, adp = null, rank = 1) => ({
  id, name: id, position, projectedPoints: points, adp, overallRank: rank, team: 'XX', bye: 9,
});

// Four teams, two rounds: picks 1,2,3,4 then 5,6,7,8 snaking back.
const CONFIG = { numTeams: 4, rounds: 2, myTeamIndex: 1 };
const fresh = (config = CONFIG) => createState(config);

const POOL = [
  pl('rb1', 'RB', 250, 2, 1), pl('rb2', 'RB', 240, 5, 2), pl('rb3', 'RB', 230, 9, 3),
  pl('wr1', 'WR', 220, 3, 4), pl('wr2', 'WR', 210, 40, 5),
  pl('qb1', 'QB', 300, 60, 6), pl('qb2', 'QB', 290, 70, 7),
  pl('te1', 'TE', 150, 80, 8),
  pl('fell', 'RB', 235, 1, 11),
  pl('k1', 'K', 171.7, 90, 9),
  pl('noadp', 'WR', 205, null, 10),
];

test('waivers are grouped by position, never one list ordered by projection', () => {
  // A global projection ordering returns nine quarterbacks off the shipped pool,
  // because projected points are not position-normalised. Measured, not assumed.
  const state = fresh();
  const groups = stillOnWaivers(state, POOL);
  assert.deepEqual(groups.map((g) => g.position), ['QB', 'RB', 'WR', 'TE']);
  assert.deepEqual(WAIVER_POSITIONS, ['QB', 'RB', 'WR', 'TE']);
});

test('each group is the best remaining at that position, best first', () => {
  const state = fresh();
  const groups = stillOnWaivers(state, POOL);
  // rb1 250, rb2 240, fell 235, rb3 230 — capped at three, so rb3 does not appear.
  const rbs = groups.find((g) => g.position === 'RB');
  assert.deepEqual(rbs.players.map((p) => p.id), ['rb1', 'rb2', 'fell']);
});

test('a drafted player is off the waiver list', () => {
  let state = fresh();
  state = applyPick(state, 'rb1');
  const rbs = stillOnWaivers(state, POOL).find((g) => g.position === 'RB');
  assert.deepEqual(rbs.players.map((p) => p.id), ['rb2', 'fell', 'rb3']);
});

test('the list is capped per position and the cap is stated', () => {
  assert.equal(WAIVERS_PER_POSITION, 3);
  const state = fresh();
  const rbs = stillOnWaivers(state, POOL, 2).find((g) => g.position === 'RB');
  assert.equal(rbs.players.length, 2);
});

test('kickers and defenses are not on the waiver list at all', () => {
  // Streamed week to week, excluded from the grade, and every team already holds one.
  const state = fresh();
  assert.equal(stillOnWaivers(state, POOL).some((g) => g.position === 'K'), false);
});

test('a position with nobody left is dropped, not shown empty', () => {
  let state = fresh();
  state = applyPick(state, 'te1');
  assert.equal(stillOnWaivers(state, POOL).some((g) => g.position === 'TE'), false);
});

test('delta is picks past ADP: positive fell, negative went early', () => {
  let state = fresh();
  state = applyPick(state, 'rb1');   // pick 1, adp 2  -> -1, a reach by one
  state = applyPick(state, 'wr2');   // pick 2, adp 40 -> -38, a big reach
  state = applyPick(state, 'fell');  // pick 3, adp 1  -> +2, fell two past his ADP
  const values = pickValues(state, POOL);
  assert.deepEqual(values.map((v) => [v.pickNumber, v.player.id, v.delta]),
    [[1, 'rb1', -1], [2, 'wr2', -38], [3, 'fell', 2]]);
});

test('each measured pick carries its round and the team that made it', () => {
  let state = fresh();
  state = applyPick(state, 'rb1');
  state = applyPick(state, 'rb2');
  state = applyPick(state, 'rb3');
  state = applyPick(state, 'wr1');
  state = applyPick(state, 'wr2');   // pick 5: round 2, and a snake puts it back on team 4
  const fifth = pickValues(state, POOL).find((v) => v.pickNumber === 5);
  assert.equal(fifth.round, 2);
  assert.equal(fifth.teamIndex, 4);
  assert.equal(fifth.teamName, 'Team 4');
});

test('a keeper is never measured against ADP', () => {
  // A keeper is held at a round the league agreed beforehand, not a draft decision.
  // Measuring one invents a huge steal that would top the list every single time.
  const state = createState({
    numTeams: 4, rounds: 2, myTeamIndex: 1,
    teams: [
      { name: 'A', keeper: { playerId: 'rb1', round: 2 } },
      { name: 'B', keeper: null }, { name: 'C', keeper: null }, { name: 'D', keeper: null },
    ],
  });
  assert.equal(pickValues(state, POOL).some((v) => v.player.id === 'rb1'), false);
});

test('an off-list pick is skipped rather than crashing the report', () => {
  let state = fresh();
  state = applyOffListPick(state);
  assert.deepEqual(pickValues(state, POOL), []);
});

test('a player with no ADP is omitted, never guessed at', () => {
  let state = fresh();
  state = applyPick(state, 'noadp');
  assert.deepEqual(pickValues(state, POOL), []);
});

test('steals are the largest positive deltas, reaches the largest negative', () => {
  let state = fresh();
  state = applyPick(state, 'wr2');   // pick 1, adp 40 -> -39
  state = applyPick(state, 'rb1');   // pick 2, adp 2  ->   0, neither
  state = applyPick(state, 'rb2');   // pick 3, adp 5  ->  -2
  state = applyPick(state, 'te1');   // pick 4, adp 80 -> -76
  state = applyPick(state, 'qb1');   // pick 5, adp 60 -> -55
  const values = pickValues(state, POOL);
  assert.deepEqual(biggestReaches(values, 2).map((v) => [v.player.id, v.delta]),
    [['te1', -76], ['qb1', -55]]);
  assert.deepEqual(biggestSteals(values, 2), [], 'nobody fell, so there are no steals');
});

test('a delta of exactly zero is neither a steal nor a reach', () => {
  // He went at his ADP. There is nothing to report, and reporting it as a 0-pick
  // steal would be padding a section with a non-fact.
  const values = [{ pickNumber: 2, delta: 0, player: pl('x', 'RB', 1, 2) }];
  assert.deepEqual(biggestSteals(values), []);
  assert.deepEqual(biggestReaches(values), []);
});
