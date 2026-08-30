import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRookie, priorSummary, matchesQuery } from '../src/core/player.js';

const p = (id, name, position, overallRank, extra) => ({
  id, name, team: (extra && extra.team) || 'XX', position, overallRank,
  positionRank: 1, projectedPoints: 300 - overallRank,
  vbd: (extra && extra.vbd) !== undefined ? extra.vbd : 100 - overallRank,
  adp: (extra && extra.adp) !== undefined ? extra.adp : overallRank, bye: 7,
});

const POOL = [
  p('1', 'Jahmyr Gibbs', 'RB', 1),
  p('2', 'Bijan Robinson', 'RB', 2),
  p('3', "Ja'Marr Chase", 'WR', 3, { team: 'CIN' }),
  p('4', 'Josh Allen', 'QB', 4, { vbd: 5 }),
  p('5', 'Brock Bowers', 'TE', 5, { adp: null }),
];

test('matchesQuery matches a partial name, case-insensitively', () => {
  assert.equal(matchesQuery(POOL[0], 'gib'), true);
  assert.equal(matchesQuery(POOL[1], 'ROBIN'), true);
  assert.equal(matchesQuery(POOL[0], 'robin'), false);
});

test('matchesQuery matches a team abbreviation by substring', () => {
  // Typing a team is how you find a QB-WR stack.
  assert.equal(matchesQuery(POOL[2], 'cin'), true);
  assert.equal(matchesQuery(POOL[2], 'ci'), true);
});

test('matchesQuery handles apostrophes in names', () => {
  assert.equal(matchesQuery(POOL[2], "ja'marr"), true);
});

test('matchesQuery passes everything through for a blank query', () => {
  // The table shows the whole pool until the user types, so blank cannot mean
  // "match nothing" the way it did for the old autocomplete.
  assert.equal(matchesQuery(POOL[0], ''), true);
  assert.equal(matchesQuery(POOL[0], '   '), true);
});

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
