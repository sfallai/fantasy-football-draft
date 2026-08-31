import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handcuffIdsFor } from '../src/core/handcuff.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points, backupId = null) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye: 9, backupId,
});

test('a starter\'s backup is a handcuff', () => {
  const roster = [pl('gibbs', 'RB', 250, 'pacheco')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['pacheco']);
});

test('a bench player\'s backup is not', () => {
  // DEFAULT_SLOTS starts one QB. The second is depth, and depth for depth is not a
  // handcuff in any sense worth a button.
  const roster = [pl('q1', 'QB', 300, 'q1-backup'), pl('q2', 'QB', 290, 'q2-backup')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['q1-backup']);
});

test('a FLEX starter counts, because he starts', () => {
  const roster = [pl('a', 'RB', 200, 'a2'), pl('b', 'RB', 180, 'b2'), pl('c', 'RB', 160, 'c2')];
  // RB1, RB2 and FLEX are all filled, so all three are starters.
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)].sort(), ['a2', 'b2', 'c2']);
});

test('a starter with no known backup contributes nothing', () => {
  const roster = [pl('gibbs', 'RB', 250, null)];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});

test('an empty roster yields an empty set, never a throw', () => {
  assert.equal(handcuffIdsFor([], DEFAULT_SLOTS).size, 0);
});

test('two starters sharing a backup list him once', () => {
  const roster = [pl('a', 'RB', 200, 'same'), pl('b', 'RB', 180, 'same')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['same']);
});

test('a kicker\'s backup is not a handcuff', () => {
  // K and DEF are streamed, are excluded from the grade, and have no depth entry —
  // but a stale backupId on one must not leak into the filter.
  const roster = [pl('k', 'K', 171.7, 'k2')];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});
