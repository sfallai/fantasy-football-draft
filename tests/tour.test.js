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

function stubDoc() {
  const document = installDomStub();
  const body = document.createElement('body');
  body.removeChild = (c) => {
    body.childNodes = body.childNodes.filter((x) => x !== c);
    body.children = body.children.filter((x) => x !== c);
    return c;
  };
  document.body = body;
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
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

test('a step whose anchor is missing still shows its card', async () => {
  // The suggestions step's anchor only exists on your own pick. Skipping it would
  // quietly teach a newcomer the app has five steps rather than six.
  const doc = stubDoc();
  doc.querySelector = () => null;
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

test('opening a second tour closes the first, leaving exactly one overlay', async () => {
  // Both call sites invoke startTour bare, with nothing tracking whether a tour is
  // already open — a stray double-click must not stack two full-viewport layers and
  // two keydown listeners on top of each other.
  const doc = stubDoc();
  const { startTour } = await import('../src/ui/tour.js');
  startTour(SETUP_STEPS, doc);
  startTour(DRAFT_STEPS, doc);
  assert.equal(doc.body.children.filter((n) => String(n.className).includes('tour-layer')).length, 1);
  const text = walk(doc.body).map((n) => n.textContent || '').join(' ');
  assert.match(text, /Who is on the clock/);
  assert.doesNotMatch(text, /Your league/);
});
