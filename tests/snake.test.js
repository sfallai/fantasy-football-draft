import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickToSlot, slotToPick, totalPicks, teamPicks, nextPickForTeam,
} from '../src/core/snake.js';

test('round 1 runs 1..N left to right', () => {
  assert.deepEqual(pickToSlot(1, 10), { round: 1, teamIndex: 1 });
  assert.deepEqual(pickToSlot(4, 10), { round: 1, teamIndex: 4 });
  assert.deepEqual(pickToSlot(10, 10), { round: 1, teamIndex: 10 });
});

test('round 2 reverses', () => {
  assert.deepEqual(pickToSlot(11, 10), { round: 2, teamIndex: 10 });
  assert.deepEqual(pickToSlot(17, 10), { round: 2, teamIndex: 4 });
  assert.deepEqual(pickToSlot(20, 10), { round: 2, teamIndex: 1 });
});

test('round 3 runs forward again', () => {
  assert.deepEqual(pickToSlot(21, 10), { round: 3, teamIndex: 1 });
  assert.deepEqual(pickToSlot(24, 10), { round: 3, teamIndex: 4 });
});

test('slotToPick is the exact inverse of pickToSlot', () => {
  for (let pick = 1; pick <= 150; pick += 1) {
    const { round, teamIndex } = pickToSlot(pick, 10);
    assert.equal(slotToPick(round, teamIndex, 10), pick, `roundtrip failed at pick ${pick}`);
  }
});

test('totalPicks multiplies teams by rounds', () => {
  assert.equal(totalPicks(10, 15), 150);
});

test('teamPicks returns the snake pattern for pick 4 of 10', () => {
  const picks = teamPicks(4, 10, 4);
  assert.deepEqual(picks, [4, 17, 24, 37]);
});

test('teamPicks for pick 7 of 10 pairs up correctly', () => {
  assert.deepEqual(teamPicks(7, 10, 3), [7, 14, 27]);
});

test('nextPickForTeam finds the following pick or null at the end', () => {
  assert.equal(nextPickForTeam(4, 4, 10, 15), 17);
  assert.equal(nextPickForTeam(16, 4, 10, 15), 17);
  assert.equal(nextPickForTeam(17, 4, 10, 15), 24);
  assert.equal(nextPickForTeam(144, 4, 10, 15), null, 'no pick after the last one');
});
