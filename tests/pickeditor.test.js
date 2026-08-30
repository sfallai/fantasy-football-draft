import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { pickEditor } = await import('../src/ui/pickeditor.js');
const { OFF_LIST_PREFIX } = await import('../src/core/state.js');

const pl = (id, name, position, team) => ({
  id, name, position, team, overallRank: 1, projectedPoints: 100, bye: 9,
});
const POOL = [pl('1', 'Jahmyr Gibbs', 'RB', 'DET'), pl('2', "Ja'Marr Chase", 'WR', 'CIN')];
const walk = (n, out = []) => { out.push(n); for (const c of n.children || []) walk(c, out); return out; };

test('the editor names the pick it is editing and who holds it', () => {
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const text = walk(node).map((n) => n.textContent).join(' ');
  assert.match(text, /43/);
  assert.match(text, /Jahmyr Gibbs/);
});

test('typing filters the candidate list by name or team', () => {
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'CIN' } });
  const names = walk(node).filter((n) => n.className === 'cand').map((n) => n.textContent);
  assert.equal(names.length, 1);
  assert.match(names[0], /Chase/);
});

test('choosing a candidate commits that player', () => {
  let committed = null;
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, (id) => { committed = id; });
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'chase' } });
  walk(node).find((n) => n.className === 'cand').listeners.click[0]();
  assert.equal(committed, '2');
});

test('an empty query shows nothing rather than the whole pool', () => {
  // 400 rows inside a popover would be unusable; the editor is a search, not a browser.
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  assert.equal(walk(node).filter((n) => n.className === 'cand').length, 0);
});

// Replaces a test that matched textContent exactly against 'clear'/'empty'/'remove',
// which no element the editor builds could ever have produced. What actually has to
// hold is that EVERY control commits a non-empty player id: a commit of '' or null
// would empty the cell, put a hole mid-draft, and move the clock. The off-list entry
// is not an exception — it commits a sentinel, and the cell stays filled.
test('every control in the editor commits a non-empty player id', () => {
  const commits = [];
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, (id) => commits.push(id));
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'a' } });

  const clickable = walk(node).filter((n) => (n.listeners.click || []).length > 0);
  assert.ok(clickable.length >= 2, 'the candidates and the off-list entry');
  for (const control of clickable) {
    commits.length = 0;
    control.listeners.click[0]();
    assert.equal(commits.length, 1, `${control.textContent} committed exactly once`);
    assert.equal(typeof commits[0], 'string');
    assert.ok(commits[0].length > 0, `${control.textContent} named someone`);
  }
});

test('the off-list entry marks the pick unknown without emptying it', () => {
  // applyOffListPick only ever fires at the pick on the clock, so this is the only
  // way to say pick 43 was someone who is not in the pool. It fills the cell with a
  // sentinel — not a hole.
  let committed = null;
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, (id) => { committed = id; });
  const offList = walk(node).find((n) => String(n.className).includes('offlist'));
  assert.ok(offList, 'the editor offers it');
  assert.match(offList.textContent, /off-list/i);
  offList.listeners.click[0]();
  assert.equal(committed, `${OFF_LIST_PREFIX}43`);
});

test('a player drafted elsewhere is offered as a named swap, not hidden', () => {
  // Two picks logged in the wrong order: neither cell used to offer the other's
  // player at all. It has to be visible AND labelled, so the exchange is never a
  // surprise.
  const pool = [{ ...POOL[0], draftedAt: 12 }, { ...POOL[1], draftedAt: null }];
  let committed = null;
  const node = pickEditor({ pick: 43, player: POOL[1] }, pool, (id) => { committed = id; });
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'gibbs' } });

  const cand = walk(node).find((n) => n.className === 'cand');
  assert.ok(cand, 'the drafted player is in the list');
  assert.match(cand.textContent, /swap with pick 12/i);
  cand.listeners.click[0]();
  assert.equal(committed, '1');
});

test('the editor does not offer the player already in the cell', () => {
  const pool = [{ ...POOL[0], draftedAt: 43 }, { ...POOL[1], draftedAt: null }];
  const node = pickEditor({ pick: 43, player: POOL[0] }, pool, () => {});
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'gibbs' } });
  assert.equal(walk(node).filter((n) => n.className === 'cand').length, 0);
});

test('a truncated candidate list says so instead of hiding the rest', () => {
  // The list caps at 8 and the pool is in overall-rank order, so a low-ranked
  // target can be pushed off the end with no hint that it exists.
  const many = Array.from({ length: 20 }, (_, i) => pl(String(i + 10), `Player ${i}`, 'RB', 'DET'));
  const node = pickEditor({ pick: 43, player: POOL[0] }, many, () => {});
  const input = walk(node).find((n) => n.tagName === 'input');

  input.listeners.input[0]({ target: { value: 'Player' } });
  assert.equal(walk(node).filter((n) => n.className === 'cand').length, 8);
  const more = walk(node).find((n) => n.className === 'cand-more');
  assert.ok(more, 'a truncation hint is shown');
  assert.match(more.textContent, /keep typing/i);

  input.listeners.input[0]({ target: { value: 'Player 3' } });
  assert.equal(walk(node).find((n) => n.className === 'cand-more'), undefined,
    'and it goes away once everything fits');
});

test('the editor focuses its input, since typing is the whole interaction', async () => {
  // Deferred: showPopover appends the node after pickEditor returns it.
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const input = walk(node).find((n) => n.tagName === 'input');
  assert.equal(input.focused, false, 'not before it is in the document');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(input.focused, true);
});
