import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { renderMyTeam } from '../src/ui/myteam.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

installDomStub();

function buildContext(roster) {
  return { roster, slots: DEFAULT_SLOTS, round: 1, totalRounds: 15, teamName: 'Test Team' };
}

const filledPlayer = {
  id: 'a', name: 'Amon-Ra St. Brown', team: 'DET', position: 'WR', projectedPoints: 200,
  overallRank: 1, positionRank: 1, adp: 1, bye: 6,
};

test('renderMyTeam appends the position-count line after the slot rows and before the needs section', () => {
  const container = document.createElement('div');
  renderMyTeam(container, buildContext([filledPlayer]));

  const classNames = container.children.map((child) => child.className);
  const lastSlotIndex = classNames.lastIndexOf('slot');
  const posCountsIndex = classNames.indexOf('pos-counts');
  const needsIndex = classNames.indexOf('needs');

  assert.ok(lastSlotIndex > -1, 'expected at least one slot row');
  assert.ok(posCountsIndex > -1, 'expected a pos-counts element');
  assert.ok(needsIndex > -1, 'expected a needs element');
  assert.ok(posCountsIndex > lastSlotIndex, 'pos-counts must render after the slot rows');
  assert.ok(posCountsIndex < needsIndex, 'pos-counts must render before the needs section');
});

test('renderMyTeam renders a filled slot row with label, name, and meta children', () => {
  const container = document.createElement('div');
  renderMyTeam(container, buildContext([filledPlayer]));

  const slotRows = container.children.filter((child) => child.className === 'slot');
  const filledRow = slotRows.find((row) => row.children.some((c) => c.textContent === filledPlayer.name));

  assert.ok(filledRow, 'expected a slot row for the filled player');
  assert.deepEqual(filledRow.children.map((c) => c.className), ['label', 'name', 'meta']);
  const meta = filledRow.children.find((c) => c.className === 'meta');
  assert.equal(meta.textContent, 'DET · bye 6');
});

test('renderMyTeam renders an unfilled slot row with no meta child', () => {
  const container = document.createElement('div');
  renderMyTeam(container, buildContext([]));

  const slotRows = container.children.filter((child) => child.className === 'slot');
  assert.ok(slotRows.length > 0, 'expected slot rows for an empty roster');
  for (const row of slotRows) {
    assert.deepEqual(row.children.map((c) => c.className), ['label', 'name empty']);
  }
});
