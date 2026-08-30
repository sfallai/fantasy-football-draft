import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needSummary, positionCountLine } from '../src/ui/myteam.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (id, position) => ({
  id, name: id, team: 'XX', position, projectedPoints: 100,
  overallRank: 1, positionRank: 1, adp: null, bye: null,
});

test('needSummary lists every position sorted high need first', () => {
  const summary = needSummary([], DEFAULT_SLOTS, 1, 15);
  assert.equal(summary.length, 6);
  assert.equal(summary[0].tier, 'high');
  assert.equal(summary[summary.length - 1].tier, 'none', 'K/DEF sink to the bottom in round 1');
});

test('needSummary labels the first starter at an empty position', () => {
  const rb = needSummary([], DEFAULT_SLOTS, 1, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'high');
  assert.equal(rb.label, 'RB1 needed');
});

test('needSummary labels the second starter once the first is filled', () => {
  const rb = needSummary([p('a', 'RB')], DEFAULT_SLOTS, 2, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'medium');
  assert.equal(rb.label, 'RB2 needed');
});

test('needSummary reports depth once starters are full', () => {
  const roster = [p('a', 'RB'), p('b', 'RB')];
  const rb = needSummary(roster, DEFAULT_SLOTS, 3, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'low');
  assert.equal(rb.label, 'FLEX / bench depth');
});

test('needSummary marks a filled position as set', () => {
  const qb = needSummary([p('q', 'QB')], DEFAULT_SLOTS, 3, 15).find((n) => n.position === 'QB');
  assert.equal(qb.label, 'QB set — depth only');
});

test('needSummary defers K and DEF until late', () => {
  const early = needSummary([], DEFAULT_SLOTS, 5, 15).find((n) => n.position === 'K');
  assert.equal(early.tier, 'none');
  assert.equal(early.label, 'wait until round 13');

  const late = needSummary([], DEFAULT_SLOTS, 13, 15).find((n) => n.position === 'K');
  assert.equal(late.tier, 'high');
  assert.equal(late.label, 'K needed');
});

test('positionCountLine reports every position, including the ones at zero', () => {
  // A zero is the point: it is how you see at a glance that you have no kicker.
  const roster = [p('a', 'RB'), p('b', 'RB'), p('c', 'WR'), p('d', 'QB')];
  assert.equal(positionCountLine(roster), 'QB:1  RB:2  WR:1  TE:0  K:0  DEF:0');
});

test('positionCountLine on an empty roster is all zeros, not blank', () => {
  assert.equal(positionCountLine([]), 'QB:0  RB:0  WR:0  TE:0  K:0  DEF:0');
});
