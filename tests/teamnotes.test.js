import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startingSpine, benchedPlayers, byeClashes, SPINE_POSITIONS } from '../src/core/teamnotes.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points, bye = 9) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye,
});

test('the spine is the starting lineup, in slot order', () => {
  const roster = [pl('qb', 'QB', 300), pl('rb1', 'RB', 200), pl('rb2', 'RB', 180), pl('wr1', 'WR', 170)];
  assert.deepEqual(
    startingSpine(roster, DEFAULT_SLOTS).map((s) => [s.label, s.player.id]),
    [['QB', 'qb'], ['RB1', 'rb1'], ['RB2', 'rb2'], ['WR1', 'wr1']],
  );
});

test('the spine leaves out the kicker and the defense', () => {
  // Same exclusion the grade now makes. A spine is the core you start every week
  // because you drafted it; a kicker is this week's kicker.
  const roster = [pl('qb', 'QB', 300), pl('k', 'K', 171.7), pl('d', 'DEF', 130.6)];
  assert.deepEqual(startingSpine(roster, DEFAULT_SLOTS).map((s) => s.player.id), ['qb']);
  assert.deepEqual(SPINE_POSITIONS, ['QB', 'RB', 'WR', 'TE']);
});

test('the spine leaves out the bench', () => {
  // DEFAULT_SLOTS starts one QB; the second is depth.
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290)];
  assert.deepEqual(startingSpine(roster, DEFAULT_SLOTS).map((s) => s.player.id), ['q1']);
});

test('benchedPlayers is exactly who could not make the lineup', () => {
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290), pl('q3', 'QB', 280)];
  assert.deepEqual(benchedPlayers(roster, DEFAULT_SLOTS).map((p) => p.id), ['q2', 'q3']);
});

test('a bye clash is two or more starters off in the same week', () => {
  const roster = [pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 10), pl('rb2', 'RB', 180, 7)];
  assert.deepEqual(
    byeClashes(roster, DEFAULT_SLOTS).map((c) => [c.week, c.players.map((p) => p.id)]),
    [[10, ['qb', 'rb1']]],
  );
});

test('one starter alone in a week is not a clash', () => {
  const roster = [pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 7)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('a benched player sharing a bye with a starter is not a clash', () => {
  // Only a projected STARTER can leave a hole in the lineup. The same rule
  // byeConflict already applies in roster.js.
  const roster = [pl('q1', 'QB', 300, 10), pl('q2', 'QB', 290, 10)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('a missing bye is never a clash', () => {
  // Two unknowns are not a known collision. byeConflict makes the same call.
  const roster = [pl('qb', 'QB', 300, null), pl('rb1', 'RB', 200, null)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('clashes are ordered worst first', () => {
  const roster = [
    pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 10), pl('rb2', 'RB', 190, 10),
    pl('wr1', 'WR', 180, 7), pl('wr2', 'WR', 170, 7),
  ];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS).map((c) => [c.week, c.players.length]),
    [[10, 3], [7, 2]]);
});

test('an empty roster produces empty everything, never a throw', () => {
  assert.deepEqual(startingSpine([], DEFAULT_SLOTS), []);
  assert.deepEqual(benchedPlayers([], DEFAULT_SLOTS), []);
  assert.deepEqual(byeClashes([], DEFAULT_SLOTS), []);
});
