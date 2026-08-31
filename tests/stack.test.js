import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackPartner } from '../src/core/stack.js';

const pl = (id, position, team, name = id) => ({
  id, name, position, team, projectedPoints: 200, bye: 9,
});

test('an available receiver pairs with your quarterback on that team', () => {
  const roster = [pl('goff', 'QB', 'DET', 'Jared Goff')];
  assert.equal(stackPartner(pl('arsb', 'WR', 'DET'), roster).name, 'Jared Goff');
});

test('a tight end counts too', () => {
  const roster = [pl('goff', 'QB', 'DET', 'Jared Goff')];
  assert.equal(stackPartner(pl('laporta', 'TE', 'DET'), roster).id, 'goff');
});

test('and it works the other way round', () => {
  const roster = [pl('arsb', 'WR', 'DET', 'Amon-Ra St. Brown')];
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), roster).name, 'Amon-Ra St. Brown');
});

test('two running backs on one team are a committee, not a stack', () => {
  // They split the same carries rather than sharing a passing play.
  const roster = [pl('gibbs', 'RB', 'DET')];
  assert.equal(stackPartner(pl('montgomery', 'RB', 'DET'), roster), null);
});

test('a receiver does not stack with another receiver', () => {
  const roster = [pl('arsb', 'WR', 'DET')];
  assert.equal(stackPartner(pl('jamo', 'WR', 'DET'), roster), null);
});

test('a different team is not a stack', () => {
  const roster = [pl('goff', 'QB', 'DET')];
  assert.equal(stackPartner(pl('nacua', 'WR', 'LAR'), roster), null);
});

test('a kicker or defense never stacks', () => {
  const roster = [pl('goff', 'QB', 'DET')];
  assert.equal(stackPartner(pl('k', 'K', 'DET'), roster), null);
  assert.equal(stackPartner(pl('def', 'DEF', 'DET'), roster), null);
});

test('an unknown team never matches, even against itself', () => {
  // Free agents carry 'FA'. Two of them are not team-mates.
  const roster = [pl('a', 'QB', 'FA')];
  assert.equal(stackPartner(pl('b', 'WR', 'FA'), roster), null);
});

test('an empty roster pairs with nobody, and does not throw', () => {
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), []), null);
});

test('the best partner is returned when there are several', () => {
  const roster = [
    { ...pl('wr2', 'WR', 'DET'), projectedPoints: 120 },
    { ...pl('wr1', 'WR', 'DET'), projectedPoints: 210 },
  ];
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), roster).id, 'wr1');
});
