import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { pickEditor } = await import('../src/ui/pickeditor.js');

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

test('the editor offers no way to empty the cell', () => {
  // Deliberate: an empty cell in the middle of a draft would move the clock.
  // A pick whose player is unknown is what Skip / off-list marks.
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const labels = walk(node).map((n) => String(n.textContent || '').toLowerCase());
  assert.equal(labels.some((t) => t === 'clear' || t === 'empty' || t === 'remove'), false);
});
