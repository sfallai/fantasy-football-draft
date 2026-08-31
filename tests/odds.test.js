import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalCdf, availabilityOdds, bandFor, BANDS } from '../src/core/odds.js';

const pl = (over = {}) => ({
  id: 'p', name: 'Player', position: 'RB', projectedPoints: 200,
  adp: 128, adpStdev: 11, adpEarliest: 100, adpLatest: 148, adpDrafts: 2017, ...over,
});

test('normalCdf matches the standard normal at known points', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1) - 0.158655) < 1e-5);
  assert.ok(Math.abs(normalCdf(-1) - (1 - normalCdf(1))) < 1e-9, 'and is symmetric');
});

test('the band table is the spec\'s, label for label', () => {
  // Written out rather than derived: the cut points are a labelling choice, and a test
  // that recomputed them from the source could not catch one being moved.
  assert.deepEqual(BANDS, [
    [0.85, 'Almost certainly still there'],
    [0.60, 'Likely still there'],
    [0.40, 'Coin flip'],
    [0.15, 'Likely gone'],
  ]);
  assert.equal(bandFor(0.9), 'Almost certainly still there');
  assert.equal(bandFor(0.85), 'Almost certainly still there', 'the floor belongs to its band');
  assert.equal(0.849 > 0.6, true);
  assert.equal(bandFor(0.849), 'Likely still there');
  assert.equal(bandFor(0.5), 'Coin flip');
  assert.equal(bandFor(0.2), 'Likely gone');
  assert.equal(bandFor(0.14), 'Almost certainly gone');
  assert.equal(bandFor(0), 'Almost certainly gone');
});

test('a player miles from his ADP is likely still there at the next pick', () => {
  const odds = availabilityOdds(pl({ adp: 200, adpLatest: 260 }), 20, 32);
  assert.ok(odds.probability > 0.9, `expected near-certain, got ${odds.probability}`);
  assert.equal(odds.band, 'Almost certainly still there');
});

test('a player whose ADP sits inside the wait is unlikely to last', () => {
  const odds = availabilityOdds(pl(), 120, 141);
  assert.ok(odds.probability < 0.4, `expected unlikely, got ${odds.probability}`);
});

test('the odds are conditioned on his still being here', () => {
  // The reason the denominator exists. Unconditioned, a player well past his ADP reads
  // "almost certainly gone" while he is visibly on the board in front of you.
  const player = pl({ adp: 128, adpStdev: 11, adpLatest: 200 });
  const early = availabilityOdds(player, 100, 112).probability;
  const late = availabilityOdds(player, 160, 172).probability;
  assert.ok(late > 0, 'a survivor is not written off entirely');
  assert.ok(late > early * 0.0001, 'and the conditioning keeps him on the scale');
});

test('waiting zero picks is certainty, not arithmetic', () => {
  assert.equal(availabilityOdds(pl(), 120, 120).probability, 1);
});

test('the model refuses when the pick is past anything ever observed', () => {
  // He has already lasted longer than he has ever been seen lasting, so the model is
  // extrapolating into the tail it is measurably worst in. Saying nothing is honest;
  // saying "almost certainly gone" about a player sitting in front of you is not.
  assert.equal(availabilityOdds(pl({ adpLatest: 148 }), 149, 160), null);
  assert.ok(availabilityOdds(pl({ adpLatest: 148 }), 148, 160), 'but not at the boundary itself');
});

test('a missing spread produces no answer, not a confident one', () => {
  // null in arithmetic yields Infinity, not NaN: (pick - adp) / null is Infinity and
  // null < 3 is true, so an unguarded model returns a confident 0 or 1. Verified: the
  // raw formula with a null sigma returns exactly 0, which renders "almost certainly gone".
  assert.equal(availabilityOdds(pl({ adpStdev: null }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adp: null }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adpStdev: 0 }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adpStdev: -3 }), 120, 141), null);
});

test('no next pick means no question to answer', () => {
  assert.equal(availabilityOdds(pl(), 120, null), null);
  assert.equal(availabilityOdds(pl(), 120, undefined), null);
});

test('the probability is always a real number in [0, 1]', () => {
  for (const [c, n, adp, sd] of [[1, 2, 1, 0.6], [170, 180, 5, 1], [10, 200, 150, 29]]) {
    const odds = availabilityOdds(pl({ adp, adpStdev: sd, adpLatest: 300 }), c, n);
    if (!odds) continue;
    assert.ok(Number.isFinite(odds.probability), `not finite for ${c}/${n}/${adp}/${sd}`);
    assert.ok(odds.probability >= 0 && odds.probability <= 1, `out of range: ${odds.probability}`);
  }
});
