import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { showPopover, closePopover } from '../src/ui/popover.js';

function stubWithBody() {
  const document = installDomStub();
  const body = document.createElement('body');
  body.removeChild = (child) => {
    body.childNodes = body.childNodes.filter((c) => c !== child);
    body.children = body.children.filter((c) => c !== child);
    return child;
  };
  document.body = body;
  document.addEventListener = () => {};
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  return { document, body };
}

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
