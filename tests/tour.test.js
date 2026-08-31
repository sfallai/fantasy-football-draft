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
