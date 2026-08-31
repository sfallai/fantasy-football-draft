import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETUP_STEPS, DRAFT_STEPS, createTour, hasSeenTour, markTourSeen,
} from '../src/ui/tour.js';

test('the setup tour covers the five things you must do before drafting', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.anchor), [
    '[data-tour="league"]', '[data-tour="position"]', '[data-tour="slots"]',
    '[data-tour="teams"]', '[data-tour="start"]',
  ]);
});

test('the draft tour covers the six parts of the draft screen', () => {
  assert.deepEqual(DRAFT_STEPS.map((s) => s.anchor), [
    '.pick-info', '.filters', '.center-scroll', '.panel.left', 'table.board', '.btn-end-draft',
  ]);
});

test('every step has something to say', () => {
  for (const step of [...SETUP_STEPS, ...DRAFT_STEPS]) {
    assert.ok(step.title.length > 0, `${step.anchor} has a title`);
    assert.ok(step.body.length > 20, `${step.anchor} says more than a label`);
  }
});

test('the suggestions step reads correctly even when it is not your turn', () => {
  // Its anchor only exists on your own pick. The card still shows, so the wording
  // cannot assume the thing it describes is on screen.
  const step = DRAFT_STEPS.find((s) => s.anchor === '.center-scroll');
  assert.match(step.body, /when it('|’)s your turn/i);
});

test('a tour advances, goes back, and reports when it is finished', () => {
  const tour = createTour(SETUP_STEPS);
  assert.equal(tour.index(), 0);
  assert.equal(tour.step().anchor, '[data-tour="league"]');
  assert.equal(tour.next(), true);
  assert.equal(tour.index(), 1);
  tour.back();
  assert.equal(tour.index(), 0);
});

test('back on the first step stays put rather than going negative', () => {
  const tour = createTour(SETUP_STEPS);
  tour.back();
  assert.equal(tour.index(), 0);
});

test('next on the last step reports the tour is over', () => {
  const tour = createTour(SETUP_STEPS);
  for (let i = 0; i < SETUP_STEPS.length - 1; i += 1) tour.next();
  assert.equal(tour.isLast(), true);
  assert.equal(tour.next(), false, 'finished');
});

test('the seen flag survives a round trip', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(hasSeenTour(storage), false);
  markTourSeen(storage);
  assert.equal(hasSeenTour(storage), true);
});

test('unusable storage means the offer simply reappears, never a crash', () => {
  // Private windows and blocked site data are already handled this way elsewhere in
  // the app. A repeated line of text beats a tour nobody can find.
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(hasSeenTour(throwing), false);
  assert.doesNotThrow(() => markTourSeen(throwing));
  assert.equal(hasSeenTour(null), false);
});

import { installDomStub } from './dom-stub.js';

// A fresh document per test, with its listener registry left intact: `document.listeners`
// is the documented test-only view of what is registered, and stubbing it out is how a
// tour that leaks a keydown listener would go unnoticed.
function stubDoc() {
  const document = installDomStub();
  globalThis.window = { innerWidth: 1400, innerHeight: 900 };
  return document;
}
const walk = (n, o = []) => { o.push(n); for (const c of n.children || []) walk(c, o); return o; };

test('the tour mounts a card showing the first step', async () => {
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  const text = walk(doc.body).map((n) => n.textContent || '').join(' ');
  assert.match(text, /Your league/);
  assert.match(text, /1 of 5/, 'and says where you are in the tour');
});

test('Next advances and Back returns', async () => {
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  const button = (label) => walk(doc.body).find((n) => n.tagName === 'button' && n.textContent === label);
  button('Next').listeners.click[0]();
  assert.match(walk(doc.body).map((n) => n.textContent || '').join(' '), /Where you pick/);
  button('Back').listeners.click[0]();
  assert.match(walk(doc.body).map((n) => n.textContent || '').join(' '), /Your league/);
});

test('finishing the tour removes it and records that it was seen', async () => {
  const doc = stubDoc();
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { startTour, hasSeenTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  const nextBtn = () => walk(doc.body).find((n) => n.tagName === 'button' && n.textContent === 'Next');
  for (let i = 0; i < SETUP_STEPS.length - 1; i += 1) nextBtn().listeners.click[0]();
  walk(doc.body).find((n) => n.tagName === 'button' && n.textContent === 'Done').listeners.click[0]();
  assert.equal(walk(doc.body).filter((n) => String(n.className).includes('tour')).length, 0);
  assert.equal(hasSeenTour(), true);
});

test('Skip closes the tour and also records it as seen', async () => {
  const doc = stubDoc();
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { startTour, hasSeenTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  walk(doc.body).find((n) => n.tagName === 'button' && n.textContent === 'Skip').listeners.click[0]();
  assert.equal(walk(doc.body).filter((n) => String(n.className).includes('tour')).length, 0);
  assert.equal(hasSeenTour(), true, 'skipping is a decision, not a postponement');
});

// The stub has no layout engine, so a rectangle exists only where a test says it
// does. These two are the only geometry in the suite: one anchor a user can see,
// and one that is present but empty.
function anchor(doc, className, rect) {
  const node = doc.createElement('div');
  node.className = className;
  if (rect) node.getBoundingClientRect = () => rect;
  doc.body.appendChild(node);
  return node;
}

test('an anchor with a real box gets a ring around it, and an uncentred card', async () => {
  const doc = stubDoc();
  anchor(doc, 'panel left', {
    left: 400, top: 120, width: 520, height: 180,
  });
  const { startTour } = await import('../src/ui/tour.js');
  startTour([{ anchor: '.panel.left', title: 'Your roster', body: 'what you hold' }], doc);

  const ring = walk(doc.body).find((n) => String(n.className) === 'tour-ring');
  assert.ok(ring, 'the ring branch ran at all');
  // RING_PAD is 6, so the ring sits 6px outside the box on every side.
  assert.deepEqual(ring.style, {
    left: '394px', top: '114px', width: '532px', height: '192px',
  });
  assert.equal(walk(doc.body).filter((n) => String(n.className) === 'tour-dim').length, 0);
  const card = walk(doc.body).find((n) => String(n.className).startsWith('tour-card'));
  assert.doesNotMatch(String(card.className), /centred/, 'the card points at the ring');
});

test('an anchor that is present but empty is dimmed, not ringed', async () => {
  // `.center-scroll` is created unconditionally and is empty whenever it is not your
  // pick, the pool is exhausted, or the draft is done: full panel width, zero height.
  // A ring there is a ~12px box drawn around nothing.
  const doc = stubDoc();
  anchor(doc, 'center-scroll', {
    left: 400, top: 300, width: 520, height: 0,
  });
  const { startTour } = await import('../src/ui/tour.js');
  startTour([{ anchor: '.center-scroll', title: 'What to take', body: 'suggestions' }], doc);

  const nodes = walk(doc.body);
  assert.equal(nodes.filter((n) => String(n.className) === 'tour-ring').length, 0, 'no ring around nothing');
  assert.equal(nodes.filter((n) => String(n.className) === 'tour-dim').length, 1, 'the page is dimmed instead');
  const card = nodes.find((n) => String(n.className).startsWith('tour-card'));
  assert.match(String(card.className), /centred/, 'and the card has nothing to point at');
});

test('a step whose anchor is missing still shows its card', async () => {
  // The suggestions step's anchor only exists on your own pick. Skipping it would
  // quietly teach a newcomer the app has five steps rather than six.
  const doc = stubDoc();
  // A capable document with the anchor genuinely absent — not a document that
  // cannot look. The distinction is the whole value of this test.
  anchor(doc, 'filters');
  assert.ok(doc.querySelector('.filters'), 'the stub really does resolve selectors');
  assert.equal(doc.querySelector('.pick-info'), null, 'and this anchor is genuinely absent');
  const { startTour } = await import('../src/ui/tour.js');
  startTour(DRAFT_STEPS, doc);
  const nodes = walk(doc.body);
  assert.match(nodes.map((n) => n.textContent || '').join(' '), /Who is on the clock/);
  // A regression that started drawing a ring at NaN coordinates would still pass
  // the assertion above, so check the ring is genuinely absent and the card knows
  // it has nothing to point at.
  assert.equal(nodes.filter((n) => String(n.className).includes('tour-ring')).length, 0);
  const card = nodes.find((n) => String(n.className).includes('tour-card'));
  assert.ok(card, 'the card still renders');
  assert.match(String(card.className), /centred/);
});

test('opening a second tour closes the first, listeners and all', async () => {
  // Both call sites invoke startTour bare, with nothing tracking whether a tour is
  // already open — a stray double-click must not stack two full-viewport layers and
  // two keydown listeners on top of each other.
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  // keydown, plus the capture-phase scroll. resize goes on window, which the stub
  // does not give addEventListener, so on()/off() skip it.
  assert.deepEqual(doc.listeners.map((l) => l.type).sort(), ['keydown', 'scroll']);

  const close = startTour(DRAFT_STEPS, doc);
  assert.equal(doc.body.children.filter((n) => String(n.className).includes('tour-layer')).length, 1);
  assert.deepEqual(doc.listeners.map((l) => l.type).sort(), ['keydown', 'scroll'],
    'one set of registrations, not two');
  const text = walk(doc.body).map((n) => n.textContent || '').join(' ');
  assert.match(text, /Who is on the clock/);
  assert.doesNotMatch(text, /Your league/);

  close();
  assert.deepEqual(doc.listeners, [], 'and closing leaves nothing behind');
});

test('Escape closes the tour; three closes are as safe as one', async () => {
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  const close = startTour(SETUP_STEPS, doc);
  const onKey = doc.listeners.find((l) => l.type === 'keydown').handler;
  onKey({ key: 'a' });
  assert.equal(doc.body.children.filter((n) => String(n.className) === 'tour-layer').length, 1);
  onKey({ key: 'Escape' });
  assert.equal(doc.body.children.filter((n) => String(n.className) === 'tour-layer').length, 0);
  assert.deepEqual(doc.listeners, []);
  assert.doesNotThrow(() => { close(); close(); });
});

test('a burst of scrolls redraws once, and closing cancels a redraw already queued', async () => {
  // The scroll listener is capture-phase on the document, so it sees every scroller
  // on the page — the player table and the teams list both scroll heavily — and
  // draw() is a full teardown, rebuild and forced layout.
  const doc = stubDoc();
  const frames = [];
  const cancelled = [];
  globalThis.window.requestAnimationFrame = (cb) => frames.push(cb);
  globalThis.window.cancelAnimationFrame = (id) => cancelled.push(id);
  const { startTour } = await import('../src/ui/tour.js');
  const close = startTour(SETUP_STEPS, doc);

  const onScroll = doc.listeners.find((l) => l.type === 'scroll').handler;
  onScroll(); onScroll(); onScroll();
  assert.equal(frames.length, 1, 'three scroll events, one queued redraw');
  frames[0]();
  onScroll();
  assert.equal(frames.length, 2, 'and the next burst queues a fresh one');

  close();
  assert.deepEqual(cancelled, [2], 'the queued redraw went with the tour');
  // Belt and braces: even if the frame ran anyway it must not remount the layer.
  frames[1]();
  assert.equal(doc.body.children.filter((n) => String(n.className) === 'tour-layer').length, 0);
});

test('with no requestAnimationFrame the tour still repositions', async () => {
  // The stub does not model rAF, and neither does every browser context. Falling
  // back to a direct draw() is what keeps the ring honest there.
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  const onScroll = doc.listeners.find((l) => l.type === 'scroll').handler;
  assert.doesNotThrow(onScroll);
  assert.equal(doc.body.children.filter((n) => String(n.className) === 'tour-layer').length, 1);
});
