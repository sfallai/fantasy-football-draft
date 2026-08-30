import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFetchedAt } from '../src/ui/dom.js';

test('formatFetchedAt renders a short, unambiguous date', () => {
  assert.equal(formatFetchedAt('2026-08-30T11:00:00.000Z'), '30 Aug');
  assert.equal(formatFetchedAt('2026-01-05T00:00:00.000Z'), '5 Jan');
});

test('formatFetchedAt reads the date in UTC, not the local zone', () => {
  // Otherwise the same build shows a different date to two people, and the test
  // passes or fails depending on where it runs.
  assert.equal(formatFetchedAt('2026-08-30T23:30:00.000Z'), '30 Aug');
  assert.equal(formatFetchedAt('2026-08-30T00:30:00.000Z'), '30 Aug');
});

test('formatFetchedAt is null when there is nothing to show', () => {
  // A fresh clone has never run a fetch. The line is omitted rather than
  // rendering "as of Invalid Date".
  assert.equal(formatFetchedAt(null), null);
  assert.equal(formatFetchedAt(undefined), null);
  assert.equal(formatFetchedAt(''), null);
  assert.equal(formatFetchedAt('not a date'), null);
});
