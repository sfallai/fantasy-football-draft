import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLOTS, slotLabels, assignSlots, countByPosition, positionalNeeds,
} from '../src/core/roster.js';

const p = (id, position, projectedPoints) => ({
  id, name: `P${id}`, team: 'XX', position, projectedPoints,
  overallRank: 1, positionRank: 1, adp: null, bye: null,
});

test('slotLabels enumerates starters then bench', () => {
  assert.deepEqual(slotLabels(DEFAULT_SLOTS), [
    'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6',
  ]);
});

test('assignSlots returns every slot with nulls when the roster is empty', () => {
  const assigned = assignSlots([], DEFAULT_SLOTS);
  assert.equal(assigned.length, 15);
  assert.ok(assigned.every((s) => s.player === null));
  assert.deepEqual(assigned[6], { label: 'FLEX', accepts: ['RB', 'WR', 'TE'], player: null });
});

test('assignSlots fills dedicated slots best-first before FLEX', () => {
  const players = [p('a', 'RB', 100), p('b', 'RB', 200), p('c', 'RB', 150)];
  const assigned = assignSlots(players, DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));

  assert.equal(byLabel.RB1, 'b', 'highest projection takes RB1');
  assert.equal(byLabel.RB2, 'c');
  assert.equal(byLabel.FLEX, 'a', 'third RB spills to FLEX');
  assert.equal(byLabel.BN1, null);
});

test('assignSlots overflows to bench once starters and FLEX are full', () => {
  const players = [
    p('a', 'RB', 100), p('b', 'RB', 200), p('c', 'RB', 150), p('d', 'RB', 90),
  ];
  const assigned = assignSlots(players, DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));
  assert.equal(byLabel.FLEX, 'a');
  assert.equal(byLabel.BN1, 'd');
});

test('assignSlots never puts a K or DEF in FLEX', () => {
  const assigned = assignSlots([p('k', 'K', 140), p('d', 'DEF', 130)], DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));
  assert.equal(byLabel.K, 'k');
  assert.equal(byLabel.DEF, 'd');
  assert.equal(byLabel.FLEX, null);
});

test('countByPosition always returns all six positions', () => {
  assert.deepEqual(countByPosition([p('a', 'RB', 1), p('b', 'RB', 1), p('c', 'WR', 1)]), {
    QB: 0, RB: 2, WR: 1, TE: 0, K: 0, DEF: 0,
  });
});

test('empty roster in round 1 makes every starting position high need', () => {
  const needs = positionalNeeds([], DEFAULT_SLOTS, 1, 15);
  assert.equal(needs.QB, 'high');
  assert.equal(needs.RB, 'high');
  assert.equal(needs.WR, 'high');
  assert.equal(needs.TE, 'high');
});

test('one RB makes RB medium — the second starter is still open', () => {
  const needs = positionalNeeds([p('a', 'RB', 200)], DEFAULT_SLOTS, 2, 15);
  assert.equal(needs.RB, 'medium');
  assert.equal(needs.WR, 'high');
});

test('starters full drops a position to low while FLEX or bench remains', () => {
  const roster = [p('a', 'RB', 200), p('b', 'RB', 190)];
  const needs = positionalNeeds(roster, DEFAULT_SLOTS, 3, 15);
  assert.equal(needs.RB, 'low');
});

test('K and DEF are none until the last three rounds', () => {
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 12, 15).K, 'none');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 12, 15).DEF, 'none');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 13, 15).K, 'high');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 13, 15).DEF, 'high');
});

test('an already-drafted K goes back to none even late', () => {
  assert.equal(positionalNeeds([p('k', 'K', 140)], DEFAULT_SLOTS, 14, 15).K, 'none');
});
