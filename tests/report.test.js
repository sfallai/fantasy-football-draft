import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stillOnWaivers, pickValues, biggestSteals, biggestReaches,
  leagueBlindSpot, benchedEarliest, notesForTeam, buildReport,
  WAIVER_POSITIONS, WAIVERS_PER_POSITION,
} from '../src/core/report.js';
import { createState, applyPick, applyOffListPick } from '../src/core/state.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

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

const BAR = { QB: 250, RB: 200, WR: 200, TE: 100, K: 0, DEF: 0 };

test('a blind spot is a position where startable players went undrafted', () => {
  // qb1 (300) and qb2 (290) both clear the QB bar of 250 and nobody took either.
  let state = fresh();
  const spots = leagueBlindSpot(state, POOL, BAR);
  const qb = spots.find((s) => s.position === 'QB');
  assert.equal(qb.count, 2);
  assert.equal(qb.bar, 250);
  assert.equal(qb.best.id, 'qb1', 'and it names the best one left');
});

test('a position nobody was wrong about is absent, not listed as zero', () => {
  let state = fresh();
  // te1 projects 150 against a bar of 100, so TE IS a blind spot here; WR is not,
  // because wr1 (220) and wr2 (210) clear 200 — so raise the bar past both.
  const spots = leagueBlindSpot(state, POOL, { ...BAR, WR: 900 });
  assert.equal(spots.some((s) => s.position === 'WR'), false);
});

test('blind spots are ordered by how many were missed', () => {
  let state = fresh();
  // RBs above 200: rb1 250, rb2 240, rb3 230, fell 235 -> four. QBs above 250: two.
  const spots = leagueBlindSpot(state, POOL, { QB: 250, RB: 200, WR: 900, TE: 900 });
  assert.deepEqual(spots.map((s) => [s.position, s.count]), [['RB', 4], ['QB', 2]]);
});

test('a drafted player is not a missed one', () => {
  let state = fresh();
  state = applyPick(state, 'qb1');
  assert.equal(leagueBlindSpot(state, POOL, BAR).find((s) => s.position === 'QB').count, 1);
});

test('the earliest picks that ended up on a bench are named, earliest first', () => {
  // Team 1 takes three RBs. DEFAULT_SLOTS starts RB1, RB2 and FLEX, so the first
  // three all start; a fourth would be the first benched. Two teams, four rounds.
  let state = createState({ numTeams: 2, rounds: 4, myTeamIndex: 1 });
  state = applyPick(state, 'rb1');   // pick 1, team 1
  state = applyPick(state, 'qb1');   // pick 2, team 2
  state = applyPick(state, 'qb2');   // pick 3, team 2  (snake)
  state = applyPick(state, 'rb2');   // pick 4, team 1
  state = applyPick(state, 'rb3');   // pick 5, team 1
  state = applyPick(state, 'wr1');   // pick 6, team 2
  state = applyPick(state, 'wr2');   // pick 7, team 2
  state = applyPick(state, 'te1');   // pick 8, team 1
  // Team 2 holds qb1 (300) and qb2 (290) with one QB slot: qb2 is benched, bought
  // at pick 3, and that is the earliest wasted pick in this league.
  const benched = benchedEarliest(state, POOL, 3);
  assert.equal(benched[0].player.id, 'qb2');
  assert.equal(benched[0].pickNumber, 3);
  assert.equal(benched[0].round, 2);
  assert.equal(benched[0].teamIndex, 2);
});

test('a team that wasted nothing contributes nothing to that list', () => {
  let state = createState({ numTeams: 2, rounds: 1, myTeamIndex: 1 });
  state = applyPick(state, 'rb1');
  state = applyPick(state, 'wr1');
  assert.deepEqual(benchedEarliest(state, POOL), []);
});

test('a team note carries its spine, its clashes, and its two most extreme picks', () => {
  // pl() defaults every player to bye 9; give these two different byes so the
  // roster is a genuine no-clash case rather than an accidental collision.
  const roster = [
    { ...pl('qb1', 'QB', 300, 60, 6), bye: 5 },
    { ...pl('rb1', 'RB', 250, 2, 1), bye: 9 },
  ];
  const values = [
    { pickNumber: 1, delta: -1, player: roster[1] },
    { pickNumber: 8, delta: 12, player: roster[0] },
  ];
  const note = notesForTeam(roster, DEFAULT_SLOTS, values);
  assert.deepEqual(note.spine.map((s) => s.player.id), ['qb1', 'rb1']);
  assert.deepEqual(note.clashes, [], 'no clash to report');
  assert.equal(note.bestValue.player.id, 'qb1', 'the pick that fell furthest');
  assert.equal(note.biggestReach.player.id, 'rb1', 'and the one taken earliest');
});

test('a team with no reach reports none rather than an inverted steal', () => {
  const roster = [pl('qb1', 'QB', 300, 60, 6)];
  const values = [{ pickNumber: 8, delta: 12, player: roster[0] }];
  const note = notesForTeam(roster, DEFAULT_SLOTS, values);
  assert.equal(note.bestValue.player.id, 'qb1');
  assert.equal(note.biggestReach, null);
});

test('buildReport assembles every section and one note per team, in team order', () => {
  let state = fresh();
  state = applyPick(state, 'rb1');
  state = applyPick(state, 'wr2');
  const report = buildReport(state, POOL, BAR);
  assert.deepEqual(Object.keys(report).sort(),
    ['benched', 'blindSpot', 'reaches', 'steals', 'teams', 'waivers']);
  assert.deepEqual(report.teams.map((t) => t.teamIndex), [1, 2, 3, 4]);
  assert.deepEqual(report.teams.map((t) => t.name), ['Team 1', 'Team 2', 'Team 3', 'Team 4']);
  assert.equal(report.reaches[0].player.id, 'wr2', 'taken 38 picks before his ADP');
});

test('buildReport survives a draft that has not started', () => {
  // The summary screen is reachable from the draft screen at any time.
  const report = buildReport(fresh(), POOL, BAR);
  assert.deepEqual(report.steals, []);
  assert.deepEqual(report.reaches, []);
  assert.deepEqual(report.benched, []);
  assert.equal(report.teams.length, 4);
  assert.deepEqual(report.teams[0].spine, []);
});

test('the blind spot is computable against the real pool and the real replacement levels', async () => {
  const { readFileSync } = await import('node:fs');
  const { replacementPoints } = await import('../src/core/vbd.js');
  const real = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
  let state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 1 });
  const replacement = replacementPoints(real, 10, DEFAULT_SLOTS);
  // The figures the spec quotes, to the decimal. If a data refresh moves them this
  // assertion is the thing that says so.
  assert.equal(replacement.QB, 288.3);
  assert.equal(replacement.RB, 167);
  assert.equal(replacement.WR, 141.7);
  assert.equal(replacement.TE, 104);
  // Before a pick is made every startable player is undrafted, so every position is a
  // blind spot. That is the degenerate case, and it proves the wiring end to end.
  const spots = leagueBlindSpot(state, real, replacement);
  assert.deepEqual(spots.map((s) => s.position).sort(), ['QB', 'RB', 'TE', 'WR']);
  for (const spot of spots) assert.ok(spot.best.projectedPoints > spot.bar);
});
