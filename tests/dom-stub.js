// A dependency-free stand-in for the DOM surface that src/ui/dom.js's el() touches:
// document.createElement, document.createTextNode, and on nodes className,
// textContent, style, setAttribute, dataset, addEventListener, appendChild
// (which also sets parentNode on the appended child, as a real DOM does).
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

function makeTextNode(value) {
  return { nodeType: 3, textContent: value };
}

// Installs a minimal `document` on globalThis and returns it. Call once per test
// (or reuse — el() only ever calls the handful of methods above).
export function installDomStub() {
  const document = {
    createElement: makeElement,
    createTextNode: makeTextNode,
  };
  globalThis.document = document;
  return document;
}
