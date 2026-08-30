import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderCenter } = await import('../src/ui/center.js');

const player = (over) => ({
  id: 'p1', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overallRank: 1,
  positionRank: 1, projectedPoints: 297.1, vbd: 80, adp: 1.4, bye: 6,
  age: 24, experience: 4, prior: { points: 289.9, games: 17, ppg: 17.1 },
  ownerName: null, ...over,
});

function ctx(tablePlayers) {
  return {
    pool: [], tablePlayers, needs: {}, surplus: {}, currentPick: 1, nextPick: 4,
    round: 1, numTeams: 10, isMyPick: false, pickingTeamName: 'Team 1',
    notes: [], vbdScale: 100,
  };
}

function render(tablePlayers) {
  const container = document.createElement('div');
  renderCenter(container, ctx(tablePlayers), { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

// Walk the stub tree, since it models no querySelector.
function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

test('the table lists drafted players as well as available ones', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const rows = find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));
  assert.equal(rows.length, 2, 'a drafted player still gets a row');
});

test('a drafted row is marked taken and names the owner', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  const taken = find(container, (n) => n.className === 'taken');
  assert.equal(taken.length, 1);
  const owner = find(container, (n) => n.className === 'owner');
  assert.equal(owner[0].textContent, 'Team 3');
});

test('an undrafted row is not marked taken and shows no owner', () => {
  const container = render([player()]);
  assert.equal(find(container, (n) => n.className === 'taken').length, 0);
  assert.equal(find(container, (n) => n.className === 'owner')[0].textContent, '');
});

test('a drafted row cannot be double-clicked into a pick', () => {
  // The guard that stops you re-drafting someone already gone.
  const container = render([player({ ownerName: 'Team 3' })]);
  const taken = find(container, (n) => n.className === 'taken')[0];
  assert.equal((taken.listeners.dblclick || []).length, 0);
});

test('an available row commits a pick on double-click, not on a single click', () => {
  let picked = null;
  const container = document.createElement('div');
  renderCenter(container, ctx([player()]), {
    onPick: (id) => { picked = id; }, onUndo() {}, onOffList() {},
  });
  const row = find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'))[0];
  assert.equal((row.listeners.click || []).length, 0, 'a stray click must never burn a pick');
  row.listeners.dblclick[0]();
  assert.equal(picked, 'p1');
});

test('a rookie is badged and a veteran is not', () => {
  const rookieContainer = render([player({ experience: 0, prior: null })]);
  assert.equal(find(rookieContainer, (n) => n.className === 'rookie').length, 1);
  const vetContainer = render([player()]);
  assert.equal(find(vetContainer, (n) => n.className === 'rookie').length, 0);
});

test('age renders, and is blank for a defense', () => {
  const container = render([player({ age: 24 }), player({ id: 'd', age: null, position: 'DEF' })]);
  const cells = find(container, (n) => n.className === 'age');
  assert.deepEqual(cells.map((c) => c.textContent), ['24', '']);
});
