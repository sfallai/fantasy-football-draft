// A dependency-free stand-in for the DOM surface that src/ui/ touches:
// document.createElement, document.createTextNode, document.body,
// document.getElementById, document add/removeEventListener, and on nodes
// className, textContent, style, setAttribute, dataset, addEventListener,
// appendChild (which also sets parentNode on the appended child, as a real DOM
// does), firstChild/removeChild (so dom.js's clear() actually clears), replaceWith,
// contains, a class-or-tag-only querySelector, and focus.
// Not a test file itself — the tests/**/*.test.js glob does not pick this up.

function makeElement(tag) {
  const node = {
    tagName: tag,
    nodeType: 1,
    className: '',
    style: {},
    dataset: {},
    attributes: {},
    childNodes: [],
    children: [],
    listeners: {},
    focused: false,
    get firstChild() {
      return node.childNodes[0] || null;
    },
    setAttribute(name, value) {
      node.attributes[name] = value;
    },
    addEventListener(type, handler) {
      (node.listeners[type] || (node.listeners[type] = [])).push(handler);
    },
    appendChild(child) {
      node.childNodes.push(child);
      if (child.nodeType === 1) node.children.push(child);
      child.parentNode = node;
      return child;
    },
    // Modelled because dom.js's clear() is a while (node.firstChild) loop: without
    // these two, clear() is a silent no-op and no render test can catch a re-render
    // that forgets to empty its container.
    removeChild(child) {
      node.childNodes = node.childNodes.filter((c) => c !== child);
      node.children = node.children.filter((c) => c !== child);
      if (child && child.parentNode === node) child.parentNode = null;
      return child;
    },
    replaceWith(replacement) {
      const parent = node.parentNode;
      if (!parent) return;
      const swap = (list) => list.map((c) => (c === node ? replacement : c));
      parent.childNodes = swap(parent.childNodes);
      parent.children = swap(parent.children);
      replacement.parentNode = parent;
      node.parentNode = null;
    },
    contains(other) {
      if (other === node) return true;
      for (const child of node.childNodes) {
        if (child && typeof child.contains === 'function' && child.contains(other)) return true;
      }
      return false;
    },
    // Only the two selector shapes src/ui/ actually uses: '.class' and 'tag'.
    querySelector(selector) {
      return queryFrom(node, selector);
    },
    focus() {
      node.focused = true;
    },
  };

  let text = '';
  Object.defineProperty(node, 'textContent', {
    get() { return text; },
    set(value) {
      text = value;
      node.childNodes = [];
      node.children = [];
    },
  });

  return node;
}

function matchesSelector(node, selector) {
  if (selector.startsWith('.')) {
    return String(node.className || '').split(/\s+/).includes(selector.slice(1));
  }
  return node.tagName === selector;
}

function queryFrom(node, selector) {
  for (const child of node.children || []) {
    if (matchesSelector(child, selector)) return child;
    const deeper = queryFrom(child, selector);
    if (deeper) return deeper;
  }
  return null;
}

function makeTextNode(value) {
  return { nodeType: 3, textContent: value };
}

function findById(node, id) {
  if (!node) return null;
  if (node.id === id || node.attributes.id === id) return node;
  for (const child of node.children || []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

// Installs a minimal `document` (and a `window` carrying viewport dimensions) on
// globalThis and returns the document. Tests are free to extend either.
export function installDomStub() {
  const listeners = [];

  const document = {
    createElement: makeElement,
    createTextNode: makeTextNode,
    // Real addEventListener dedupes on (type, callback, capture) — `once` is not
    // part of that key. Modelling that is the whole point of popover.js's
    // containment-based dismissal, so the stub has to model it too.
    addEventListener(type, handler, options) {
      const capture = Boolean(options && options.capture);
      const already = listeners.some(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      );
      if (already) return;
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, options) {
      const capture = Boolean(options && options.capture);
      const at = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      );
      if (at >= 0) listeners.splice(at, 1);
    },
    // Test-only view of the registrations above.
    listeners,
    getElementById(id) {
      return findById(document.body, id);
    },
  };

  document.body = makeElement('body');
  globalThis.document = document;
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  return document;
}
