// One module owns the open popover, so a second panel opening one closes the first.
// Two independent copies of this state let the board's roster popover and the centre
// panel's player detail sit on screen at the same time, each unaware of the other.
let openNode = null;

export function closePopover() {
  if (openNode && openNode.parentNode) openNode.parentNode.removeChild(openNode);
  openNode = null;
}

export function showPopover(node, event) {
  closePopover();
  node.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
  node.style.top = `${Math.min(event.clientY, window.innerHeight - 400)}px`;
  document.body.appendChild(node);
  openNode = node;
  // Deferred, or the click that opened this popover immediately closes it.
  setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
}
