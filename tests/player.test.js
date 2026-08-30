import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRookie, priorSummary } from '../src/core/player.js';

test('isRookie is true for a first-year player with no prior season', () => {
  assert.equal(isRookie({ experience: 0, prior: null }), true);
  assert.equal(isRookie({ experience: 1, prior: null }), true);
});

test('isRookie is false for a veteran who has a prior season on record', () => {
  // The one experience===1 player in the shipped pool is 27 years old with a
  // 2025 season. ESPN's experience counter is not self-consistent, so the
  // absence of a prior season is what actually settles it.
  assert.equal(isRookie({ experience: 1, prior: { points: 22.7, games: 4, ppg: 5.7 } }), false);
  assert.equal(isRookie({ experience: 5, prior: null }), false);
});

test('isRookie is false when experience is unknown', () => {
  // Defenses and failed athlete lookups both land here. Absent evidence is not
  // evidence of a rookie.
  assert.equal(isRookie({ experience: null, prior: null }), false);
});

test('priorSummary reads as a stat line', () => {
  assert.equal(
    priorSummary({ prior: { points: 289.9, games: 17, ppg: 17.1 } }),
    '289.9 pts in 17 games · 17.1 ppg',
  );
});

test('priorSummary is null when there is no prior season', () => {
  assert.equal(priorSummary({ prior: null }), null);
  assert.equal(priorSummary({}), null);
});

test('priorSummary reports a season that happened but produced nothing', () => {
  // Distinct from having no prior season at all — the player was around and
  // did not score, which is worth seeing.
  assert.equal(
    priorSummary({ prior: { points: 0, games: 0, ppg: 0 } }),
    '0 pts in 0 games · 0 ppg',
  );
});
