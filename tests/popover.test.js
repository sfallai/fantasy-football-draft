import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { showPopover, closePopover } from '../src/ui/popover.js';

function stubWithBody() {
  const document = installDomStub();
  return { document, body: document.body };
}

// showPopover arms its dismiss listener in a setTimeout(0), so a test that cares
// about the arming has to let the macrotask queue drain first.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('showPopover attaches the node to the body', () => {
  const { document, body } = stubWithBody();
  const node = document.createElement('div');
  showPopover(node, { clientX: 10, clientY: 20 });
  assert.equal(body.children.length, 1);
  closePopover();
});

test('opening a second popover closes the first', () => {
  // Two panels each opening their own popover is exactly the bug this module
  // exists to prevent.
  const { document, body } = stubWithBody();
  const first = document.createElement('div');
  const second = document.createElement('div');
  showPopover(first, { clientX: 0, clientY: 0 });
  showPopover(second, { clientX: 0, clientY: 0 });
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0], second);
  closePopover();
});

test('closePopover is safe when nothing is open', () => {
  stubWithBody();
  closePopover();
  closePopover();
});

test('showPopover keeps the node inside the viewport', () => {
  const { document } = stubWithBody();
  const node = document.createElement('div');
  showPopover(node, { clientX: 1190, clientY: 790 });
  assert.ok(parseInt(node.style.left, 10) <= 1200 - 280);
  assert.ok(parseInt(node.style.top, 10) <= 800 - 400);
  closePopover();
});

test('the popover is offset clear of the pointer', () => {
  // A popover whose corner sits under the pointer eats the second click of a
  // double-click on a player name, and the pick silently never happens.
  const { document } = stubWithBody();
  const node = document.createElement('div');
  showPopover(node, { clientX: 500, clientY: 300 });
  assert.equal(node.style.left, '514px');
  assert.equal(node.style.top, '316px');
  assert.ok(parseInt(node.style.left, 10) > 500, 'left clears the pointer');
  assert.ok(parseInt(node.style.top, 10) > 300, 'top clears the pointer');
  closePopover();
});

test('a measured node is clamped against its real size, not the fallback', () => {
  const { document } = stubWithBody();
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ width: 300, height: 120 });
  showPopover(node, { clientX: 1190, clientY: 790 });
  assert.equal(node.style.left, `${1200 - 300}px`);
  assert.equal(node.style.top, `${800 - 120}px`);
  closePopover();
});

test('opening three popovers leaves exactly one arming of each dismiss listener', async () => {
  // addEventListener dedupes on (type, callback, capture) and ignores `once`, so a
  // one-shot arming that was never consumed used to linger and close the *next*
  // popover the instant it opened. The listeners must track openNode exactly.
  const { document } = stubWithBody();
  for (let i = 0; i < 3; i += 1) {
    showPopover(document.createElement('div'), { clientX: 5, clientY: 5 });
    await flush();
  }
  const armed = (type) => document.listeners.filter((l) => l.type === type).length;
  assert.equal(armed('click'), 1);
  assert.equal(armed('keydown'), 1);
  assert.equal(document.listeners.length, 2, 'and nothing else');
  closePopover();
  await flush();
  assert.equal(document.listeners.length, 0, 'closing removes both armings again');
});

test('Escape dismisses the open popover', async () => {
  // The pick editor focuses its input, so the mouse is nowhere near the click
  // outside that the other listener waits for.
  const { document, body } = stubWithBody();
  showPopover(document.createElement('div'), { clientX: 5, clientY: 5 });
  await flush();

  const dismiss = document.listeners.find((l) => l.type === 'keydown').handler;
  dismiss({ key: 'a' });
  assert.equal(body.children.length, 1, 'an ordinary keystroke leaves it open');
  dismiss({ key: 'Escape' });
  assert.equal(body.children.length, 0);
  assert.equal(document.listeners.length, 0, 'and the armings went with it');
});

test('a click inside the open popover does not dismiss it', async () => {
  const { document, body } = stubWithBody();
  const node = document.createElement('div');
  const inner = document.createElement('span');
  node.appendChild(inner);
  showPopover(node, { clientX: 5, clientY: 5 });
  await flush();

  const dismiss = document.listeners.find((l) => l.type === 'click').handler;
  dismiss({ target: inner });
  assert.equal(body.children.length, 1, 'a click on the popover keeps it open');

  dismiss({ target: document.createElement('button') });
  assert.equal(body.children.length, 0, 'a click outside closes it');
});
