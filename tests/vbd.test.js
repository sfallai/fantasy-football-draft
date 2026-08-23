import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineRanks, replacementPoints, withVbd } from '../src/core/vbd.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (position, positionRank, projectedPoints) => ({
  id: `${position}${positionRank}`, name: `${position}${positionRank}`, team: 'XX',
  position, positionRank, overallRank: positionRank, projectedPoints, adp: null, bye: null,
});

test('baseline ranks match the spec examples for a 10-team league', () => {
  const baselines = baselineRanks(10, DEFAULT_SLOTS);
  assert.equal(baselines.QB, 12, 'QB12 per spec');
  assert.equal(baselines.RB, 24, 'RB24 per spec: 10 * (2 + 0.4 flex)');
  assert.equal(baselines.WR, 24);
  assert.equal(baselines.TE, 12);
  assert.equal(baselines.K, 10);
  assert.equal(baselines.DEF, 10);
});

test('baseline ranks scale with league size', () => {
  const baselines = baselineRanks(12, DEFAULT_SLOTS);
  assert.equal(baselines.RB, 29, '12 * 2.4 = 28.8 rounds to 29');
  assert.equal(baselines.QB, 14, '12 * 1.2 = 14.4 floors to 14');
});

test('replacementPoints reads the player sitting at each baseline rank', () => {
  const pool = [];
  for (let i = 1; i <= 30; i += 1) pool.push(p('RB', i, 300 - i * 5));
  for (let i = 1; i <= 20; i += 1) pool.push(p('QB', i, 280 - i * 4));

  const replacement = replacementPoints(pool, 10, DEFAULT_SLOTS);
  assert.equal(replacement.RB, 300 - 24 * 5, 'RB24');
  assert.equal(replacement.QB, 280 - 12 * 4, 'QB12');
});

test('replacementPoints falls back to the worst player when the pool is shallow', () => {
  const pool = [p('TE', 1, 150), p('TE', 2, 120), p('TE', 3, 90)];
  const replacement = replacementPoints(pool, 10, DEFAULT_SLOTS);
  assert.equal(replacement.TE, 90, 'only 3 TEs exist, so TE3 is the floor');
});

test('replacementPoints is 0 for a position with no players', () => {
  const replacement = replacementPoints([p('RB', 1, 200)], 10, DEFAULT_SLOTS);
  assert.equal(replacement.WR, 0);
});

test('withVbd subtracts the positional replacement, not a global one', () => {
  const pool = [p('RB', 1, 300), p('QB', 1, 380)];
  const out = withVbd(pool, { QB: 300, RB: 120, WR: 0, TE: 0, K: 0, DEF: 0 });

  const rb = out.find((x) => x.position === 'RB');
  const qb = out.find((x) => x.position === 'QB');
  assert.equal(rb.vbd, 180);
  assert.equal(qb.vbd, 80, 'the higher-scoring QB has the lower VBD');
  assert.ok(rb.vbd > qb.vbd, 'VBD reorders across positions');
});

test('withVbd does not mutate the input players', () => {
  const pool = [p('RB', 1, 300)];
  withVbd(pool, { QB: 0, RB: 120, WR: 0, TE: 0, K: 0, DEF: 0 });
  assert.equal(pool[0].vbd, undefined);
});
