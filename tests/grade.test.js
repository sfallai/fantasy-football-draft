import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamStrength, gradeFor, gradeTeams, NEUTRAL_GRADE } from '../src/core/grade.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye: 9,
});
const teamsNamed = (...names) => names.map((name) => ({ name, keeper: null }));

test('teamStrength counts the starting lineup and ignores the bench', () => {
  // DEFAULT_SLOTS starts one QB. A second is bench depth and must not inflate a grade —
  // the spec's whole basis is "it measures what actually scores".
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290)];
  assert.equal(teamStrength(roster, DEFAULT_SLOTS), 300);
});

test('teamStrength counts a FLEX starter', () => {
  // Two RBs fill RB1/RB2, the third starts at FLEX, so all three count.
  const roster = [pl('a', 'RB', 200), pl('b', 'RB', 150), pl('c', 'RB', 100)];
  assert.equal(teamStrength(roster, DEFAULT_SLOTS), 450);
});

test('teamStrength is zero for an empty roster', () => {
  assert.equal(teamStrength([], DEFAULT_SLOTS), 0);
});

test('gradeFor maps each band, inclusive at its floor', () => {
  assert.equal(gradeFor(2.0), 'A+');
  assert.equal(gradeFor(1.5), 'A+', 'the floor belongs to the band above it');
  assert.equal(gradeFor(1.49), 'A');
  assert.equal(gradeFor(0), 'B-');
  assert.equal(gradeFor(-0.01), 'C+');
  assert.equal(gradeFor(-1.5), 'D');
  assert.equal(gradeFor(-1.51), 'F');
});

test('gradeTeams ranks by strength, best first', () => {
  const rosters = {
    1: [pl('a', 'RB', 100)],
    2: [pl('b', 'RB', 300)],
    3: [pl('c', 'RB', 200)],
  };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('Weak', 'Strong', 'Middle'));
  assert.deepEqual(rows.map((r) => r.name), ['Strong', 'Middle', 'Weak']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
  // Strengths 300/200/100 give a standard deviation of 81.65, so the spread is
  // z = +1.22 / 0 / -1.22 — an A and a D, not the A+ and F that three teams this far
  // apart look like they ought to earn. The grade is relative to THIS league, and three
  // teams cannot spread themselves more than about 1.2 standard deviations apart.
  assert.equal(rows[0].grade, 'A');
  assert.equal(rows[1].grade, 'B-', 'the team exactly at the mean');
  assert.equal(rows[2].grade, 'D');
});

test('every team grades neutrally before anyone has picked', () => {
  // All strengths are zero, so the standard deviation is zero. There is no information
  // to tell the teams apart, and dividing by it would produce NaN on every grade shown.
  const rosters = { 1: [], 2: [], 3: [] };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('A', 'B', 'C'));
  assert.deepEqual(rows.map((r) => r.grade), [NEUTRAL_GRADE, NEUTRAL_GRADE, NEUTRAL_GRADE]);
  assert.deepEqual(rows.map((r) => r.z), [0, 0, 0], 'z is 0, never NaN');
});

test('gradeTeams breaks a strength tie by team order, not at random', () => {
  const rosters = { 1: [pl('a', 'RB', 100)], 2: [pl('b', 'RB', 100)] };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('First', 'Second'));
  assert.deepEqual(rows.map((r) => r.name), ['First', 'Second']);
});

test('gradeTeams handles a team with no roster entry at all', () => {
  // rostersByTeam always has a key per team today, but a missing one must not throw.
  const rows = gradeTeams({}, DEFAULT_SLOTS, teamsNamed('A', 'B'));
  assert.deepEqual(rows.map((r) => r.strength), [0, 0]);
});
