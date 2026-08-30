import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPlayers, filterByPositions, formatVbd, SORT_KEYS } from '../src/ui/center.js';

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

test('SORT_KEYS covers the four sorts named in the spec', () => {
  assert.deepEqual(SORT_KEYS, ['overallRank', 'position', 'vbd', 'adp']);
});

test('sortPlayers by overallRank is ascending', () => {
  assert.deepEqual(sortPlayers(POOL, 'overallRank').map((x) => x.id), ['1', '2', '3', '4', '5']);
});

test('sortPlayers by vbd is descending', () => {
  const sorted = sortPlayers(POOL, 'vbd');
  assert.equal(sorted[0].id, '1');
  assert.equal(sorted[sorted.length - 1].id, '4', 'lowest VBD lands last');
});

test('sortPlayers by adp puts nulls last', () => {
  assert.equal(sortPlayers(POOL, 'adp').at(-1).id, '5');
});

test('sortPlayers by position groups QB, RB, WR, TE, K, DEF', () => {
  assert.deepEqual(sortPlayers(POOL, 'position').map((x) => x.position),
    ['QB', 'RB', 'RB', 'WR', 'TE']);
});

test('sortPlayers does not mutate its input', () => {
  const before = POOL.map((x) => x.id);
  sortPlayers(POOL, 'vbd');
  assert.deepEqual(POOL.map((x) => x.id), before);
});

test('formatVbd signs below-replacement players instead of printing +-37', () => {
  assert.equal(formatVbd(37.2), '+37');
  assert.equal(formatVbd(-37.4), '-37');
  assert.equal(formatVbd(0), '+0');
  assert.equal(formatVbd(-0.4), '+0', 'never renders a negative zero');
});

test('filterByPositions narrows to the selected positions', () => {
  assert.deepEqual(filterByPositions(POOL, ['RB']).map((x) => x.id), ['1', '2']);
  assert.deepEqual(filterByPositions(POOL, ['RB', 'WR']).map((x) => x.id), ['1', '2', '3']);
});

test('an empty selection means everything, never nothing', () => {
  // ALL is the clear button, and a blank board would be a worse answer than the
  // full one — the recommendations must never render empty.
  assert.equal(filterByPositions(POOL, []).length, 5);
});

test('filterByPositions does not mutate its input', () => {
  const before = POOL.map((x) => x.id);
  filterByPositions(POOL, ['RB']);
  assert.deepEqual(POOL.map((x) => x.id), before);
});
