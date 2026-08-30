import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerMeta } from '../src/ui/slotrow.js';

test('playerMeta shows the team and bye week', () => {
  assert.equal(playerMeta({ team: 'DET', bye: 6 }), 'DET · bye 6');
});

test('playerMeta says so when a player has no bye on record', () => {
  // A free agent has no pro team, so no bye. An em-dash here would read as
  // "week —", which is worse than saying there isn't one.
  assert.equal(playerMeta({ team: 'FA', bye: null }), 'FA · no bye');
});

test('playerMeta is empty for an unfilled slot', () => {
  assert.equal(playerMeta(null), '');
  assert.equal(playerMeta(undefined), '');
});
