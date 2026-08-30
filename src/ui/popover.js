// One module owns the open popover, so a second panel opening one closes the first.
// Were there two independent copies of this state, the board's roster popover and the
// centre panel's player detail could sit on screen at the same time, each unaware of
// the other.
let openNode = null;

// `.pop` is position: fixed above the table. Anchoring its corner exactly at the
// pointer puts it under the *second* click of a double-click, which then hit-tests
// onto the popover instead of the row — and the pick never happens. Offsetting clears
// the pointer; browsers cancel a dblclick only after the pointer moves several pixels,
// so 14px sits outside the double-click envelope without moving the popover far.
const OFFSET_X = 14;
const OFFSET_Y = 16;

// Used only when the node cannot report its own size yet (no layout, or a test stub).
const FALLBACK_WIDTH = 280;
const FALLBACK_HEIGHT = 400;

// Containment, not a { once: true } arming. addEventListener dedupes on
// (type, callback, capture) and `once` is not part of that key, so a one-shot listener
// that is never consumed — because the opening click called stopPropagation and never
// reached the document — would survive and swallow the next popover. Dismissing on a
// click *outside* the open node cannot desync from openNode: closePopover always
// removes exactly what showPopover added.
function dismissOnOutsideClick(event) {
  if (openNode && event && openNode.contains(event.target)) return;
  closePopover();
}

export function closePopover() {
  if (openNode && openNode.parentNode) openNode.parentNode.removeChild(openNode);
  openNode = null;
  document.removeEventListener('click', dismissOnOutsideClick);
}

export function showPopover(node, event) {
  closePopover();
  node.style.left = `${event.clientX + OFFSET_X}px`;
  node.style.top = `${event.clientY + OFFSET_Y}px`;
  document.body.appendChild(node);
  openNode = node;

  // Measured after appending, because `.pop` sizes to its content: the centre panel's
  // player detail and the board's roster popover are nothing like the same height.
  // A zero measurement (no layout yet) falls back to the old constants.
  const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
  const width = (rect && rect.width) || FALLBACK_WIDTH;
  const height = (rect && rect.height) || FALLBACK_HEIGHT;
  node.style.left = `${Math.max(0, Math.min(event.clientX + OFFSET_X, window.innerWidth - width))}px`;
  node.style.top = `${Math.max(0, Math.min(event.clientY + OFFSET_Y, window.innerHeight - height))}px`;

  // Deferred, or the click that opened this popover immediately closes it.
  setTimeout(() => document.addEventListener('click', dismissOnOutsideClick), 0);
}
