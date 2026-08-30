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
  // TE, not QB: QB has no FLEX slot to fall back to, so a filled QB always lands in
  // the 'bench' tier and is dropped from needSummary entirely (see the drops test
  // below). TE is FLEX-eligible, so one TE with a FLEX slot still open lands in
  // 'low' instead, and is the tier that actually reaches this "set — depth only" label.
  const te = needSummary([p('t', 'TE')], DEFAULT_SLOTS, 3, 15).find((n) => n.position === 'TE');
  assert.equal(te.label, 'TE set — depth only');
});

test('needSummary defers K and DEF until late', () => {
  const early = needSummary([], DEFAULT_SLOTS, 5, 15).find((n) => n.position === 'K');
  assert.equal(early.tier, 'none');
  assert.equal(early.label, 'wait until round 13');

  const late = needSummary([], DEFAULT_SLOTS, 13, 15).find((n) => n.position === 'K');
  assert.equal(late.tier, 'high');
  assert.equal(late.label, 'K needed');
});

test('needSummary keeps a bench-tier position but marks it set, not ranked', () => {
  // QB has no FLEX fallback, so a filled QB always lands in the 'bench' tier. It
  // stays in the list as a confirmation, not a ranked need.
  const summary = needSummary([p('q1', 'QB')], DEFAULT_SLOTS, 5, 15);
  const qb = summary.find((n) => n.position === 'QB');
  assert.ok(qb, 'a set position still appears in the list');
  assert.equal(qb.set, true);
  assert.equal(qb.label, 'QB set');
});

test('needSummary sorts a set position after every other entry, even a "none" tier', () => {
  // K and DEF sit at 'none' this early — a need not yet reached. QB is 'bench' — a
  // need already satisfied. Satisfied ranks below "not yet reached", so QB must sort
  // after K and DEF here, not merely after the 'high' tiers.
  const summary = needSummary([p('q1', 'QB')], DEFAULT_SLOTS, 5, 15);
  const qbIndex = summary.findIndex((n) => n.position === 'QB');
  assert.equal(qbIndex, summary.length - 1, 'the set QB sorts dead last');
  assert.ok(summary.slice(0, -1).every((n) => !n.set), 'every entry before it is unranked, not set');
});

test('needSummary keeps a FLEX-coverable position ranked, not set', () => {
  // Two RBs fill both dedicated RB slots, but a FLEX slot can still start a third,
  // so RB lands in 'low' rather than 'bench' and stays ranked.
  const roster = [p('r1', 'RB'), p('r2', 'RB')];
  const rb = needSummary(roster, DEFAULT_SLOTS, 5, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'low');
  assert.equal(rb.set, false);
});

test('needSummary lists every position on an empty roster, none of them set', () => {
  const summary = needSummary([], DEFAULT_SLOTS, 1, 15);
  assert.equal(summary.length, 6);
  assert.ok(summary.every((n) => !n.set));
});

test('positionCountLine reports every position, including the ones at zero', () => {
  // A zero is the point: it is how you see at a glance that you have no kicker.
  const roster = [p('a', 'RB'), p('b', 'RB'), p('c', 'WR'), p('d', 'QB')];
  assert.equal(positionCountLine(roster), 'QB:1  RB:2  WR:1  TE:0  K:0  DEF:0');
});

test('positionCountLine on an empty roster is all zeros, not blank', () => {
  assert.equal(positionCountLine([]), 'QB:0  RB:0  WR:0  TE:0  K:0  DEF:0');
});
