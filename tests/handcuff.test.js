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
  // DEFAULT_SLOTS starts RB1, RB2 and FLEX. The fourth back is depth, and depth for
  // depth is not a handcuff in any sense worth a button.
  const roster = [
    pl('a', 'RB', 200, 'a2'), pl('b', 'RB', 180, 'b2'),
    pl('c', 'RB', 160, 'c2'), pl('d', 'RB', 140, 'd2'),
  ];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)].sort(), ['a2', 'b2', 'c2']);
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

// A handcuff is the back who inherits the workload when the starter goes down. That
// is a running-back fact, and only a running-back fact — see HANDCUFF_POSITIONS.
test('a wide receiver\'s backup is not a handcuff', () => {
  // The WR2 on an NFL depth chart is a starter in his own right: Chase's "backup" in
  // the shipped data is Tee Higgins. Targets are redistributed, not inherited.
  const roster = [pl('chase', 'WR', 280, 'higgins')];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});

test('a tight end\'s backup is not a handcuff', () => {
  const roster = [pl('te1', 'TE', 200, 'te2')];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});

test('a quarterback\'s backup is not a handcuff either', () => {
  // A backup QB genuinely does inherit the job, but in a one-QB league nobody drafts
  // one, so the line is noise on every card for no decision it could change.
  const roster = [pl('allen', 'QB', 380, 'allen-backup')];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});

test('a mixed lineup yields only the running backs\' backups', () => {
  const roster = [
    pl('rb1', 'RB', 250, 'rb1-backup'), pl('wr1', 'WR', 240, 'wr1-backup'),
    pl('qb1', 'QB', 380, 'qb1-backup'), pl('te1', 'TE', 200, 'te1-backup'),
  ];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['rb1-backup']);
});
