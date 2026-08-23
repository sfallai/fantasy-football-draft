import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamsPickingBetween, needCountsBetween, competitiveNotes } from '../src/core/competitive.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (id, position, projectedPoints) => ({
  id, name: id, team: 'XX', position, projectedPoints,
  overallRank: 1, positionRank: 1, adp: null, bye: null, vbd: projectedPoints - 100,
});

test('teamsPickingBetween walks the snake turn between two of my picks', () => {
  // Picking 4th of 10: my picks are 4 and 17. Between them: 5..16.
  assert.deepEqual(teamsPickingBetween(4, 17, 10), [5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5]);
});

test('teamsPickingBetween is empty for back-to-back picks', () => {
  assert.deepEqual(teamsPickingBetween(10, 11, 10), []);
});

test('teamsPickingBetween handles a null next pick', () => {
  assert.deepEqual(teamsPickingBetween(144, null, 10), []);
});

test('needCountsBetween counts picks by teams that need each position', () => {
  const rostersByTeam = {
    5: [p('a', 'RB', 200), p('b', 'RB', 190)], // RB starters full -> low
    6: [],                                     // needs everything -> high
    7: [],
  };
  const counts = needCountsBetween({
    currentPick: 4, nextPick: 8, numTeams: 10, rounds: 15, rostersByTeam, slots: DEFAULT_SLOTS,
  });
  assert.equal(counts.RB, 2, 'teams 6 and 7 need RB; team 5 does not');
  assert.equal(counts.WR, 3, 'all three still need WR');
});

test('needCountsBetween treats a team with no roster entry as needing everything', () => {
  const counts = needCountsBetween({
    currentPick: 4, nextPick: 7, numTeams: 10, rounds: 15, rostersByTeam: {}, slots: DEFAULT_SLOTS,
  });
  assert.equal(counts.RB, 2);
  assert.equal(counts.TE, 2);
});

test('competitiveNotes warns when demand for a thin position exceeds supply', () => {
  const pool = [p('rb1', 'RB', 260), p('rb2', 'RB', 250)]; // only 2 RBs above replacement
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 0, RB: 150, WR: 150, TE: 0, K: 0, DEF: 0 },
  });
  assert.ok(notes.length > 0);
  assert.ok(/RB/.test(notes[0]), notes.join(' | '));
  assert.ok(/12 teams? pick/i.test(notes[0]) || /12 of/.test(notes[0]), notes[0]);
});

test('competitiveNotes stays quiet when supply comfortably exceeds demand', () => {
  const pool = Array.from({ length: 40 }, (_, i) => p(`rb${i}`, 'RB', 300 - i));
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 0, RB: 150, WR: 150, TE: 0, K: 0, DEF: 0 },
  });
  assert.ok(!notes.some((n) => /^RB/.test(n)), notes.join(' | '));
});

test('competitiveNotes returns nothing for back-to-back picks', () => {
  const notes = competitiveNotes({
    currentPick: 10, nextPick: 11, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool: [p('rb1', 'RB', 260)],
    replacement: { RB: 150 },
  });
  assert.deepEqual(notes, []);
});

test('competitiveNotes caps at three notes', () => {
  const pool = [p('rb1', 'RB', 260), p('wr1', 'WR', 250), p('te1', 'TE', 240), p('qb1', 'QB', 300)];
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 200, RB: 150, WR: 150, TE: 150, K: 0, DEF: 0 },
  });
  assert.ok(notes.length <= 3);
});
