// A dependency-free stand-in for the DOM surface that src/ui/ touches:
// document.createElement, document.createTextNode, document.body,
// document.getElementById, document.querySelector, document add/removeEventListener,
// and on nodes className, textContent, style, setAttribute, dataset,
// addEventListener, appendChild (which also sets parentNode on the appended child,
// as a real DOM does), firstChild/removeChild (so dom.js's clear() actually clears),
// replaceWith, contains, querySelector, and focus.
//
// Nothing here measures or lays anything out: there is no layout engine, and
// getBoundingClientRect exists only where an individual test stubs one onto a node.
// Any test that cares about geometry has to state the rectangle itself.
// Not a test file itself — the tests/**/*.test.js glob does not pick this up.

// Real elements reflect `el.dataset.foo = x` into the `data-foo` attribute (and vice
// versa) — they are two views of the same underlying storage. A selector-matcher
// keyed on data-tour (or a test walking .attributes) has to see it either way.
function toDataAttr(prop) {
  return `data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function makeElement(tag) {
  const node = {
    tagName: tag,
    nodeType: 1,
    className: '',
    style: {},
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
    // See matchesSelector below for the shapes understood.
    querySelector(selector) {
      return queryFrom(node, selector);
    },
    focus() {
      node.focused = true;
    },
    // Real elements have one, and the download path uses it on a detached anchor:
    // create the link, click it, remove it. Without this the whole Blob-and-anchor
    // route was untestable, which is why it carried a comment saying so.
    click() {
      for (const handler of node.listeners.click || []) handler({ target: node });
    },
  };

  node.dataset = new Proxy({}, {
    set(target, prop, value) {
      target[prop] = value;
      node.attributes[toDataAttr(prop)] = value;
      return true;
    },
    deleteProperty(target, prop) {
      delete target[prop];
      delete node.attributes[toDataAttr(prop)];
      return true;
    },
  });

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

// The selector shapes src/ui/ actually uses, and only those: a bare tag (`tbody`),
// one or more classes (`.pop`, `.panel.left`), a tag followed by classes
// (`table.board`), and a single attribute test (`[data-tour="league"]`). No
// combinators, no descendant selectors — nothing in the app asks for one, and the
// tour's anchors are the only reason this grew past `.class` and `tag`.
const ATTR_SELECTOR = /^\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/;

function matchesSelector(node, selector) {
  const attr = selector.match(ATTR_SELECTOR);
  if (attr) {
    const actual = node.attributes ? node.attributes[attr[1]] : undefined;
    if (actual === undefined) return false;
    const wanted = attr[2] ?? attr[3] ?? attr[4];
    return wanted === undefined || String(actual) === wanted;
  }
  const parts = selector.split('.');
  const tag = parts.shift();
  if (tag && node.tagName !== tag) return false;
  const classes = String(node.className || '').split(/\s+/);
  return parts.every((name) => classes.includes(name));
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

// addEventListener takes either a boolean or an options object as its third
// argument, and the two must key the registry identically — a call site that added
// with `true` and removed with `{capture: true}` would otherwise leak invisibly.
function captureOf(options) {
  return options === true || Boolean(options && options.capture);
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
      const capture = captureOf(options);
      const already = listeners.some(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      );
      if (already) return;
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, options) {
      const capture = captureOf(options);
      const at = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      );
      if (at >= 0) listeners.splice(at, 1);
    },
    // Test-only view of the registrations above.
    listeners,
    // Without this every `doc.querySelector(...)` in src/ui/ resolves to null under
    // test — which is how a tour ring drawn around an empty container shipped green.
    // Searches from body, the same tree a real document.querySelector walks.
    querySelector(selector) {
      return queryFrom(document.body, selector);
    },
    getElementById(id) {
      return findById(document.body, id);
    },
  };

  document.body = makeElement('body');
  globalThis.document = document;
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  return document;
}
