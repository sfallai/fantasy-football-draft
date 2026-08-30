import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderCenter, resetView } = await import('../src/ui/center.js');
const { closePopover } = await import('../src/ui/popover.js');

const player = (over) => ({
  id: 'p1', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overallRank: 1,
  positionRank: 1, projectedPoints: 297.1, vbd: 80, adp: 1.4, bye: 6,
  age: 24, experience: 4, prior: { points: 289.9, games: 17, ppg: 17.1 },
  ownerName: null, ...over,
});

function ctx(tablePlayers) {
  return {
    pool: tablePlayers.filter((pl) => !pl.ownerName),
    tablePlayers,
    needs: {}, surplus: {}, currentPick: 1, nextPick: 4,
    round: 1, numTeams: 10, isMyPick: false, pickingTeamName: 'Team 1',
    notes: [], vbdScale: 100,
  };
}

// `view` is module state that survives between renders on purpose, so each test
// starts from the documented defaults.
function render(tablePlayers) {
  resetView();
  const container = document.createElement('div');
  renderCenter(container, ctx(tablePlayers), { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

// Walk the stub tree, since it models only a one-hit querySelector.
function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

const button = (container, label) =>
  find(container, (n) => n.tagName === 'button' && n.textContent === label)[0];
const bodyRows = (container) =>
  find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));

// Drafted players are hidden by default now, so the tests about them say so.
function showEveryone(container) {
  button(container, 'Available only').listeners.click[0]();
}

test('the table lists drafted players as well as available ones', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  showEveryone(container);
  assert.equal(bodyRows(container).length, 2, 'a drafted player still gets a row');
});

test('a drafted row is marked taken and names the owner', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  showEveryone(container);
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
  showEveryone(container);
  const taken = find(container, (n) => n.className === 'taken')[0];
  assert.equal((taken.listeners.dblclick || []).length, 0);
});

test('an available row commits a pick on double-click, not on a single click', () => {
  let picked = null;
  resetView();
  const container = document.createElement('div');
  renderCenter(container, ctx([player()]), {
    onPick: (id) => { picked = id; }, onUndo() {}, onOffList() {},
  });
  const row = bodyRows(container)[0];
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

test('the rookie badge sits before the name, where nothing can clip it', () => {
  const container = render([player({ experience: 0, prior: null })]);
  const cell = find(container, (n) => n.className === 'pname')[0];
  assert.equal(cell.children[0].className, 'rookie');
  assert.equal(cell.children[1].textContent, 'Jahmyr Gibbs');
});

test('age renders, and is blank for a defense', () => {
  const container = render([player({ age: 24 }), player({ id: 'd', age: null, position: 'DEF' })]);
  const cells = find(container, (n) => n.className === 'age');
  assert.deepEqual(cells.map((c) => c.textContent), ['24', '']);
});

test('the pick-entry box is gone and the filter is the only text input', () => {
  const container = render([player()]);
  const inputs = find(container, (n) => n.tagName === 'input');
  assert.equal(inputs.length, 1, 'one text input, not two');
  assert.equal(inputs[0].attributes.placeholder, 'Filter by name or team…');
});

test('Undo and Skip survive the removal of the pick box', () => {
  const container = render([player()]);
  const labels = find(container, (n) => n.tagName === 'button').map((b) => b.textContent);
  assert.ok(labels.includes('Undo'));
  assert.ok(labels.includes('Skip / off-list'));
});

test('typing in the filter narrows the table', () => {
  const container = render([player(), player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' })]);
  assert.equal(bodyRows(container).length, 2);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'only the matching player is left');
  assert.ok(find(rows[0], (n) => n.textContent === 'Bijan Robinson').length);
});

test('the clear button empties the filter', () => {
  const container = render([player(), player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' })]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  assert.equal(bodyRows(container).length, 1);

  button(container, '✕').listeners.click[0]();

  const reRendered = find(container, (n) => n.tagName === 'input')[0];
  assert.equal(reRendered.attributes.value, '', 'the filter box comes back empty');
  assert.equal(bodyRows(container).length, 2, 'and every player is listed again');
});

test('a re-render replaces the panel rather than appending a second copy', () => {
  // dom.js's clear() is what makes this true; the stub models firstChild/removeChild
  // so a render path that forgot to clear would show up here.
  const container = render([player()]);
  const before = container.children.length;
  button(container, '✕').listeners.click[0]();
  assert.equal(container.children.length, before);
  assert.equal(find(container, (n) => n.tagName === 'table').length, 1);
});

test('the heading counts what is shown as well as what is available', () => {
  const container = render([
    player(),
    player({ id: 'p2', name: 'Bijan Robinson', team: 'ATL' }),
    player({ id: 'p3', name: 'Taken Guy', ownerName: 'Team 3' }),
  ]);
  const heading = find(container, (n) => n.tagName === 'h2' && n.textContent.startsWith('Players'))[0];
  assert.equal(heading.textContent, 'Players (2 shown · 2 available)');

  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Bijan' } });
  assert.equal(heading.textContent, 'Players (1 shown · 2 available)', 'the count follows the table');
});

test('Available only is on by default and hides drafted players', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const toggle = button(container, 'Available only');
  assert.equal(toggle.className, 'selected', 'it starts on');
  assert.equal(bodyRows(container).length, 1, 'the drafted player is hidden');

  toggle.listeners.click[0]();
  assert.equal(button(container, 'Available only').className, '', 'toggling turns it off');
  assert.equal(bodyRows(container).length, 2, 'and the drafted player comes back');
});

// Backlog: "Filter by name, always show result but no selectable if already
// drafted (if on team show team)". Available only must govern browsing only —
// an active query overrides it so a search never comes back empty just because
// the match happens to be drafted.
test('Available only hides a drafted player when there is no query', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  assert.equal(button(container, 'Available only').className, 'selected', 'on by default');
  assert.equal(bodyRows(container).length, 1, 'the drafted player has no row');
});

test('a query overrides Available only and surfaces a matching drafted player', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Taken' } });

  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'the drafted player has a row despite the toggle being on');
  assert.equal(rows[0].className, 'taken', 'and it is marked taken');
  assert.equal((rows[0].listeners.dblclick || []).length, 0, 'so it cannot be double-clicked into a pick');
  const owner = find(rows[0], (n) => n.className === 'owner')[0];
  assert.equal(owner.textContent, 'Team 3', 'and it names the owning team');
});

test('a query still hides drafted players that do not match it', () => {
  const container = render([
    player({ name: 'Available Guy' }),
    player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' }),
  ]);
  const input = find(container, (n) => n.tagName === 'input')[0];
  input.listeners.input[0]({ target: { value: 'Available' } });

  const rows = bodyRows(container);
  assert.equal(rows.length, 1, 'only the match is shown');
  assert.ok(find(rows[0], (n) => n.textContent === 'Available Guy').length);
});

test('the glossary button is present and opens on click', () => {
  const container = render([player()]);
  const help = button(container, '?');
  assert.ok(help);

  const before = document.body.children.length;
  help.listeners.click[0]({ clientX: 40, clientY: 60 });
  assert.equal(document.body.children.length, before + 1, 'a popover was appended');

  const pop = document.body.children[document.body.children.length - 1];
  assert.equal(pop.className, 'pop');
  const terms = find(pop, (n) => n.tagName === 'dt').map((n) => n.textContent);
  // Every need tier the recommendation card can actually print must be defined,
  // and no tier the app never shows may be.
  for (const term of ['BPA', 'Proj', 'VBD', 'ADP', 'Bye', 'R', 'Need', 'high', 'medium', 'low', 'bench', 'none']) {
    assert.ok(terms.includes(term), `the glossary defines ${term}`);
  }
  assert.ok(!terms.includes('depth'), 'no tier the app never shows');
  assert.ok(!terms.includes('not needed'), 'no tier the app never shows');
  closePopover();
});

test('a player name is clickable for detail', () => {
  const container = render([player()]);
  const nameCell = find(container, (n) => n.className === 'pname')[0];

  const before = document.body.children.length;
  nameCell.listeners.click[0]({ clientX: 100, clientY: 120 });
  assert.equal(document.body.children.length, before + 1);

  const pop = document.body.children[document.body.children.length - 1];
  assert.equal(pop.className, 'pop');
  const lines = find(pop, () => true).map((n) => n.textContent);
  assert.ok(lines.includes('Jahmyr Gibbs'), 'the popover names the player');
  assert.ok(lines.some((t) => t.includes('RB · DET · #1 overall')), 'and summarises him');
  assert.ok(lines.some((t) => t.includes('289.9 pts in 17 games')), 'and shows last season');
  closePopover();
});

test('the detail popover names the owner of a drafted player', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  showEveryone(container);
  const nameCell = find(container, (n) => n.className === 'pname')[0];
  nameCell.listeners.click[0]({ clientX: 100, clientY: 120 });

  const pop = document.body.children[document.body.children.length - 1];
  const lines = find(pop, () => true).map((n) => n.textContent);
  assert.ok(lines.includes('Drafted by Team 3'), 'the one fact the greyed row was conveying');
  closePopover();
});

// Correction: the spec requires the filter input to stay keyboard-first — focused
// after every render — now that pickEntry (which used to own that focus call) is gone.
test('the filter input is focused after a render', async () => {
  const container = render([player()]);
  const inputs = find(container, (n) => n.tagName === 'input');
  assert.equal(inputs.length, 1);
  // The focus call is deferred (setTimeout 0), same as pickEntry's used to be.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inputs[0].focused, true);
});
