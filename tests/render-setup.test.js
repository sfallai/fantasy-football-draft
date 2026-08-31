import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderSetup } = await import('../src/ui/setup.js');
const { DEFAULT_CONFIG } = await import('../src/core/state.js');

function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

test('every setup section carries a tour anchor', () => {
  const root = document.createElement('div');
  renderSetup(root, DEFAULT_CONFIG, () => {}, () => {});
  const anchors = find(root, (n) => n.attributes && n.attributes['data-tour'])
    .map((n) => n.attributes['data-tour']);
  assert.deepEqual(anchors, ['league', 'position', 'slots', 'teams', 'start']);
});

test('a tour anchor wraps its heading and its content, not just the heading', () => {
  // A ring around a bare <h2> would highlight the words and none of the fields
  // they label, which is worse than no ring at all.
  const root = document.createElement('div');
  renderSetup(root, DEFAULT_CONFIG, () => {}, () => {});
  const league = find(root, (n) => n.attributes && n.attributes['data-tour'] === 'league')[0];
  assert.ok(league.children.length >= 2, 'heading plus at least one content node');
});
