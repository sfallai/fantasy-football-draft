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

test('renderMyTeam renders a set need row with the set class and no tier chip', () => {
  // One QB fills the only QB slot, so QB is 'set' — a confirmation, not a ranking.
  const container = document.createElement('div');
  const qb = { id: 'q', name: 'Filled QB', team: 'XX', position: 'QB', projectedPoints: 100 };
  renderMyTeam(container, buildContext([qb]));

  const needsSection = container.children.find((c) => c.className === 'needs');
  const rows = needsSection.children.filter((c) => c.className.startsWith('need-row'));
  const qbRow = rows.find((row) => row.children[0].textContent === 'QB set');

  assert.ok(qbRow, 'expected a "QB set" need row');
  assert.equal(qbRow.className, 'need-row set');
  assert.equal(qbRow.children.length, 1, 'a set row has no tier chip');
});

test('renderMyTeam renders a ranked need row with a tier chip and no set class', () => {
  const container = document.createElement('div');
  renderMyTeam(container, buildContext([]));

  const needsSection = container.children.find((c) => c.className === 'needs');
  const rows = needsSection.children.filter((c) => c.className.startsWith('need-row'));
  const rbRow = rows.find((row) => row.children[0].textContent === 'RB1 needed');

  assert.ok(rbRow, 'expected an "RB1 needed" need row');
  assert.equal(rbRow.className, 'need-row');
  assert.deepEqual(rbRow.children.map((c) => c.className), ['', 'tier tier-high']);
});
