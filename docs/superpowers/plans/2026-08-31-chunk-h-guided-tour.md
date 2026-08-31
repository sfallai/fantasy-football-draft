# Chunk H — Guided Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give someone who has never used this app a five-step tour of the setup screen and a six-step tour of the draft screen, offered once on a first visit.

**Architecture:** Two independent tours, each launched from the screen it describes, so neither ever changes `screen` or drives a re-render mid-step. One positioned element provides both the highlight ring and the page dim, via a huge `box-shadow` spread. Step lists and the advance/back state are pure and tested; the positioning is not testable here and the plan says so where it matters.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`, `tests/dom-stub.js`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk H)

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently.
- **`draft.html` is a build artifact.** Never hand-edit. `tests/build.test.js` rebuilds in-process and asserts byte equality, so any `src/` change needs `npm run build` before the suite is green.
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: a violation silently breaks the built page rather than failing the build.
- **Do not run `npm run fetch`.** `data/players.json` and `data/fetched-at.json` must be byte-identical.
- **The tour never touches draft state.** It reads the DOM and its own `seen` flag; nothing else.
- **Neither tour changes `screen`.** Each runs entirely on the screen that launched it.
- **A missing anchor shows the card without a ring — it does not skip the step.**
- **`el()` skips `null` children and `null` attribute values.** That is how conditional nodes are built throughout this codebase.

---

### Task 1: Give the tour something to point at

The tour anchors each step to a CSS selector, and several of its targets have nothing to select. The setup screen's sections are bare `<h2>` headings followed by loose content with no wrapper, and `app.js` builds the left and right panels as `class: 'panel'` with nothing to distinguish them — only the centre panel carries a second class.

This task is purely structural. No behaviour changes.

**Files:**
- Modify: `src/ui/setup.js`, `src/ui/app.js`
- Test: `tests/render-setup.test.js` (new), `tests/render-app.test.js`

**Interfaces:**
- Produces: the anchors every later step depends on —
  `[data-tour="league"]`, `[data-tour="position"]`, `[data-tour="slots"]`, `[data-tour="teams"]`, `[data-tour="start"]` on the setup screen; `.panel.left` and `.panel.right` on the draft screen.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render-app.test.js`:

```js
test('the draft screen panels are individually addressable', () => {
  // The tour anchors steps to selectors. Three panels sharing one class gives it
  // nothing to point at.
  stored.clear(); resetView();
  stored.set(STORAGE_KEY, serialize(createState(CONFIG)));
  init();
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel left').length, 1);
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel center').length, 1);
  assert.equal(find(appRoot, (n) => String(n.className) === 'panel right').length, 1);
});
```

`tests/setup-config.test.js` currently imports only the pure helpers (`buildConfig`,
`validateConfig`, `resizeTeams`) and never renders, so it has no DOM stub. Rather than
turning a pure-logic file into a rendering one, put these two tests in a new
`tests/render-setup.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderSetup } = await import('../src/ui/setup.js');
const { DEFAULT_CONFIG } = await import('../src/core/state.js');

function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}
```

```js
test('every setup section carries a tour anchor', () => {
  const root = document.createElement('div');
  renderSetup(root, DEFAULT_CONFIG, () => {}, () => {});
  const anchors = find(root, (n) => n.attributes && n.attributes['data-tour'])
    .map((n) => n.attributes['data-tour']);
  assert.deepEqual(anchors, ['league', 'position', 'slots', 'teams', 'start']);
});

test('a tour anchor wraps its heading and its content, not just the heading', () => {
  // A ring around a bare <h2> would highlight the words and none of the fields
  // they label, which is worse than no ring at all.
  const root = document.createElement('div');
  renderSetup(root, DEFAULT_CONFIG, () => {}, () => {});
  const league = find(root, (n) => n.attributes && n.attributes['data-tour'] === 'league')[0];
  assert.ok(league.children.length >= 2, 'heading plus at least one content node');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/render-app.test.js tests/render-setup.test.js`
Expected: FAIL — no `panel left` node, and no `data-tour` attributes exist.

- [ ] **Step 3: Add the anchors**

In `src/ui/app.js`, change the two panel constructions in `renderDraft`:

```js
  const left = el('div', { class: 'panel left' }, []);
  const center = el('div', { class: 'panel center' }, []);
  const right = el('div', { class: 'panel right' }, []);
```

(`center` already carries its second class; the CSS keys off `.panel.center` and is unaffected by the other two gaining one.)

In `src/ui/setup.js`, wrap each section so the ring covers the heading *and* the fields it labels. Replace the four heading-plus-content pairs inside the `panel setup` children with:

```js
    el('div', { class: 'setup-section', dataset: { tour: 'league' } }, [
      el('h2', { text: 'League Settings' }, []),
      el('div', { class: 'field-row' }, [
        numberField('Teams', 'numTeams', 4, 16, onNumTeamsChange),
        numberField('Rounds', 'rounds', 1, 30, onRoundsChange),
        el('div', { class: 'field' }, [
          el('label', { text: 'Scoring' }, []),
          el('select', { disabled: 'disabled' }, [el('option', { text: 'Standard (non-PPR)' }, [])]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Draft type' }, []),
          el('select', { disabled: 'disabled' }, [el('option', { text: 'Snake' }, [])]),
        ]),
      ]),
    ]),

    el('div', { class: 'setup-section', dataset: { tour: 'position' } }, [
      el('h2', { text: 'Your Draft Position' }, []),
      positionRow,
    ]),

    el('div', { class: 'setup-section', dataset: { tour: 'slots' } }, [
      el('h2', { text: 'Roster Slots' }, []),
      slotFields,
    ]),

    el('div', { class: 'setup-section', dataset: { tour: 'teams' } }, [
      el('h2', { text: 'Teams & Keepers' }, []),
      // Fixed-height scroller: changing the team count adds or removes rows inside
      // this box rather than growing the page, so nothing below it — the Start Draft
      // button in particular — shifts under the pointer mid-click.
      el('div', { class: 'teams-scroll' }, [
        el('table', { class: 'teams' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: '#' }, []), el('th', { text: 'Team name' }, []),
            el('th', { text: 'Keeper (optional)' }, []), el('th', { text: 'Round' }, []),
          ])]),
          tbody,
        ]),
      ]),
    ]),
```

and add `dataset: { tour: 'start' }` to the existing **Start Draft** button's attributes.

`el()` maps a `dataset` object onto the node, and the stub models it — this is how `data-tour` reaches the DOM.

- [ ] **Step 4: Verify nothing moved**

Run: `npm test`. Every existing setup and render test must still pass — this task changes structure, not behaviour, and a broken setup screen here would be a real regression. Only `tests/build.test.js`'s freshness check may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/setup.js src/ui/app.js tests/render-setup.test.js tests/render-app.test.js
git commit -m "refactor(ui): give the setup sections and side panels stable anchors"
```

---

### Task 2: The step lists and the tour's state

Pure, DOM-free, and the part that can genuinely be tested.

**Files:**
- Create: `src/ui/tour.js`
- Test: `tests/tour.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SETUP_STEPS`, `DRAFT_STEPS` — arrays of `{ anchor, title, body }`.
  - `createTour(steps) -> { step(), index(), total, isLast(), next(), back() }`. `next()` returns `false` once the tour is finished.
  - `hasSeenTour(storage)`, `markTourSeen(storage)` — the `seen` flag, defaulting to `globalThis.localStorage`.

- [ ] **Step 1: Write the failing tests**

Create `tests/tour.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tour.test.js` — FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/ui/tour.js`:

```js
export const TOUR_SEEN_KEY = 'ffdraft.tour.seen.v1';

// Five steps, in the order someone actually fills the screen in.
export const SETUP_STEPS = [
  {
    anchor: '[data-tour="league"]',
    title: 'Your league',
    body: 'How many teams, and how many rounds. The defaults match a standard ten-team, fifteen-round draft, so most people change nothing here.',
  },
  {
    anchor: '[data-tour="position"]',
    title: 'Where you pick',
    body: 'Click the slot you drew. Everything the app suggests depends on knowing when your turn comes round again.',
  },
  {
    anchor: '[data-tour="slots"]',
    title: 'What a lineup looks like',
    body: 'The positions your league starts each week. Change these only if your league is unusual — they decide who counts as a starter.',
  },
  {
    anchor: '[data-tour="teams"]',
    title: 'Everyone else',
    body: 'Name the other teams if you like, and add any keepers with the round they cost. A keeper needs both a player and a round.',
  },
  {
    anchor: '[data-tour="start"]',
    title: 'Then start',
    body: 'You can come back and reset later, but the draft board is built from these settings, so glance over them once before you begin.',
  },
];

// Six steps. The second is the core loop and the one thing a newcomer must leave knowing.
export const DRAFT_STEPS = [
  {
    anchor: '.pick-info',
    title: 'Who is on the clock',
    body: 'The current round and pick, whose turn it is, and how many picks until yours comes round again.',
  },
  {
    anchor: '.filters',
    title: 'Recording a pick',
    body: 'Type any part of a name or a team into the box, then double-click the player in the list below. Do this for every pick, including other teams — the app follows the whole draft, not just yours.',
  },
  {
    anchor: '.center-scroll',
    title: 'What to take',
    body: 'When it is your turn, three suggestions appear here with a line explaining each, plus a couple of longer shots. They are only shown on your own pick.',
  },
  {
    anchor: '.panel.left',
    title: 'Your roster',
    body: 'Your lineup as it fills up, what you still need, and how many of each position you hold. Positions you have already covered drop out of the ranking.',
  },
  {
    anchor: 'table.board',
    title: 'The board',
    body: 'Every pick in the draft. Click any filled square to correct the player in it, or a team name at the top to see their roster and grade.',
  },
  {
    anchor: '.btn-end-draft',
    title: 'Afterwards',
    body: 'When the draft is over this ranks all the teams with a grade, so you can see how yours came out.',
  },
];

export function createTour(steps) {
  let i = 0;
  return {
    step: () => steps[i] || null,
    index: () => i,
    total: steps.length,
    isLast: () => i === steps.length - 1,
    // false once the tour has run off the end, which is the caller's cue to close.
    next: () => { i += 1; return i < steps.length; },
    back: () => { i = Math.max(0, i - 1); },
  };
}

// Storage can be absent or throw — a private window, blocked site data, a full quota.
// The app already treats that as "carry on without persistence", and the worst case here
// is that the offer appears again next visit.
function usable(storage) {
  const candidate = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  return candidate && typeof candidate.getItem === 'function' ? candidate : null;
}

export function hasSeenTour(storage) {
  const store = usable(storage);
  if (!store) return false;
  try {
    return store.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(storage) {
  const store = usable(storage);
  if (!store) return;
  try {
    store.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Nothing to do — the offer will simply appear again.
  }
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/tour.test.js` → PASS. Then `npm test` — only the build-freshness check may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/tour.js tests/tour.test.js
git commit -m "feat(tour): step lists, tour state, and the seen flag"
```

---

### Task 3: The overlay, the buttons, and the offer

**Files:**
- Modify: `src/ui/tour.js`, `src/ui/app.js`, `src/ui/setup.js`, `src/styles.css`
- Test: `tests/tour.test.js`

**Interfaces:**
- Consumes: `SETUP_STEPS`, `DRAFT_STEPS`, `createTour`, `hasSeenTour`, `markTourSeen` (Task 2); the anchors from Task 1.
- Produces: `startTour(steps, doc)` — mounts the overlay and returns a `close()` function. `doc` defaults to `document`, so tests can pass a stub.

- [ ] **Step 1: Write the failing tests**

Add to `tests/tour.test.js`. The stub needs a `body` and `querySelector`; `tests/dom-stub.js` models both.

```js
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
  assert.match(walk(doc.body).map((n) => n.textContent || '').join(' '), /Who is on the clock/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tour.test.js` — FAIL, `startTour` is not exported.

- [ ] **Step 3: Implement the overlay**

Add to `src/ui/tour.js`, with `import { el, clear } from './dom.js';` on one line at the top:

```js
// The ring and the dim are one element: a transparent box outlined around the target,
// carrying a spread large enough to darken the rest of the page. Two elements would need
// four rectangles to cut a hole, and they would disagree at the corners.
const RING_PAD = 6;

export function startTour(steps, doc = document) {
  const tour = createTour(steps);
  const layer = el('div', { class: 'tour-layer' }, []);
  doc.body.appendChild(layer);

  function close() {
    markTourSeen();
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    doc.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e && e.key === 'Escape') close();
  }
  doc.addEventListener('keydown', onKey);

  function draw() {
    clear(layer);
    const step = tour.step();
    if (!step) { close(); return; }

    // A missing anchor is expected, not exceptional — see the suggestions step.
    const target = doc.querySelector ? doc.querySelector(step.anchor) : null;
    const box = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;

    if (box && box.width) {
      layer.appendChild(el('div', {
        class: 'tour-ring',
        style: {
          left: `${box.left - RING_PAD}px`, top: `${box.top - RING_PAD}px`,
          width: `${box.width + RING_PAD * 2}px`, height: `${box.height + RING_PAD * 2}px`,
        },
      }, []));
    } else {
      // No target to cut a hole around, so dim the whole page and centre the card.
      layer.appendChild(el('div', { class: 'tour-dim' }, []));
    }

    layer.appendChild(el('div', { class: box && box.width ? 'tour-card' : 'tour-card centred' }, [
      el('div', { class: 'tour-count', text: `${tour.index() + 1} of ${tour.total}` }, []),
      el('h3', { text: step.title }, []),
      el('p', { text: step.body }, []),
      el('div', { class: 'tour-controls' }, [
        el('button', { class: 'tour-skip', text: 'Skip', onClick: close }, []),
        tour.index() > 0 ? el('button', { text: 'Back', onClick: () => { tour.back(); draw(); } }, []) : null,
        el('button', {
          class: 'primary',
          text: tour.isLast() ? 'Done' : 'Next',
          onClick: () => { if (tour.next()) draw(); else close(); },
        }, []),
      ]),
    ]));
  }

  draw();
  return close;
}
```

- [ ] **Step 4: Wire both tours in**

In `src/ui/app.js`, add `startTour`, `SETUP_STEPS`, `DRAFT_STEPS`, `hasSeenTour` to a single-line import from `./tour.js`.

In the left panel, beside the other buttons:

```js
  left.appendChild(el('button', {
    class: 'btn-tour', text: 'Show me around', style: { marginTop: '8px' },
    onClick: () => startTour(DRAFT_STEPS),
  }, []));
```

Pass the offer state into `renderSetup` so the setup screen can show its line:

```js
  renderSetup(container, (state && state.config) || DEFAULT_CONFIG, startDraft, handleImport, {
    offerTour: !hasSeenTour(),
    onStartTour: () => startTour(SETUP_STEPS),
  });
```

In `src/ui/setup.js`, take the new fifth parameter and render the offer above the first section:

```js
export function renderSetup(root, initialConfig, onStart, onImport, tour = {}) {
```

```js
    // Shown once. Most first-time users would never find a button nobody told them
    // about; anyone who has done this before loses one line of text.
    tour.offerTour ? el('div', { class: 'tour-offer' }, [
      el('span', { text: 'First time here?' }, []),
      el('button', { class: 'btn-tour', text: 'Show me around', onClick: tour.onStartTour }, []),
    ]) : null,
```

- [ ] **Step 5: Add the CSS**

```css
.tour-layer { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
.tour-ring { position: fixed; border: 2px solid var(--accent); border-radius: 8px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.62); pointer-events: none; }
.tour-dim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.62); }
.tour-card { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); width: min(420px, calc(100vw - 32px)); background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.5); pointer-events: auto; }
.tour-card.centred { top: 50%; bottom: auto; transform: translate(-50%, -50%); }
.tour-card h3 { margin: 4px 0 6px; font-size: 15px; }
.tour-card p { margin: 0; color: var(--text); font-size: 13px; line-height: 1.5; }
.tour-count { color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.tour-controls { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.tour-controls .tour-skip { margin-right: auto; color: var(--muted); }
.tour-offer { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; color: var(--muted); font-size: 13px; }
```

- [ ] **Step 6: Verify**

Run: `npm test` — only the build-freshness check may fail.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tour.js src/ui/app.js src/ui/setup.js src/styles.css tests/tour.test.js
git commit -m "feat(tour): the overlay, the controls, and the first-visit offer"
```

---

### Task 4: Rebuild and check what the tests cannot

**Files:**
- Modify: `draft.html` (rebuilt)

- [ ] **Step 1: Rebuild**

```bash
npm test      # build-freshness red — expected
npm run build
npm test      # 0 failures
```

- [ ] **Step 2: Confirm the chunk reached the bundle**

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
for (const [label, needle] of [
  ["startTour", "function startTour"],
  ["SETUP_STEPS", "SETUP_STEPS"],
  ["DRAFT_STEPS", "DRAFT_STEPS"],
  ["seen key", "ffdraft.tour.seen.v1"],
  ["ring CSS", ".tour-ring"],
  ["offer CSS", ".tour-offer"],
  ["setup anchors", "data-tour"],
  ["left panel class", "panel left"],
]) console.log(label + ":", html.includes(needle));
console.log("no leftover module syntax:", !/^\s*(import|export)\s/m.test(html));
'
```

Expected: every line `true`.

- [ ] **Step 3: Check every anchor actually resolves**

The tests use a stub with no layout, so a step could point at a selector that matches nothing and no test would notice. Verify each one against the real rendered DOM:

```bash
node --input-type=module -e '
import { installDomStub } from "./tests/dom-stub.js";
const document = installDomStub();
const body = document.createElement("body");
body.removeChild = (c) => { body.childNodes = body.childNodes.filter(x=>x!==c); body.children = body.children.filter(x=>x!==c); return c; };
document.body = body; document.addEventListener = () => {}; document.removeEventListener = () => {};
globalThis.window = { innerWidth: 1400, innerHeight: 900 };
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k,v) => store.set(k,String(v)), removeItem: k => store.delete(k) };
const appRoot = document.createElement("div"); appRoot.id = "app"; body.appendChild(appRoot);
document.getElementById = (id) => (id === "app" ? appRoot : null);
const all = JSON.parse(await (await import("node:fs/promises")).readFile("data/players.json","utf8"));
globalThis.window.PLAYERS = all;

const { SETUP_STEPS, DRAFT_STEPS } = await import("./src/ui/tour.js");
const { createState, applyPick, serialize, STORAGE_KEY } = await import("./src/core/state.js");
const { init } = await import("./src/ui/app.js");

const walk = (n, o = []) => { o.push(n); for (const c of n.children || []) walk(c, o); return o; };
const matches = (nodes, sel) => nodes.filter((n) => {
  if (sel.startsWith("[data-tour=")) return n.dataset && n.dataset.tour === sel.slice(12, -2);
  if (sel.startsWith(".")) return String(n.className).split(" ").join(".").includes(sel.slice(1));
  if (sel.includes(".")) { const [t, c] = sel.split("."); return n.tagName === t && String(n.className).includes(c); }
  return n.tagName === sel;
}).length;

init();
console.log("SETUP anchors (no draft in progress):");
for (const s of SETUP_STEPS) console.log("  " + s.anchor.padEnd(26), matches(walk(appRoot), s.anchor) > 0 ? "found" : "*** MISSING ***");

let state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 1 });
state = applyPick(state, all[0].id);
store.set(STORAGE_KEY, serialize(state));
init();
console.log("DRAFT anchors (draft in progress, not your pick):");
for (const s of DRAFT_STEPS) {
  const n = matches(walk(appRoot), s.anchor);
  console.log("  " + s.anchor.padEnd(26), n > 0 ? "found" : "absent — card shows without a ring");
}
'
```

Every setup anchor must be **found**. On the draft screen, `.center-scroll` may legitimately be absent when it is not your pick — that is the designed fallback — but every other draft anchor must be found. A missing anchor anywhere else is a bug in the step list.

- [ ] **Step 4: Commit**

```bash
git add draft.html
git commit -m "chore: rebuild draft.html"
```

---

## Verification

Chunk H is done when:

- `npm test` passes with more tests than the 329 this chunk started from.
- `data/players.json` and `data/fetched-at.json` are untouched.
- The bundle check in Task 4 prints `true` on every line, and the anchor check finds every selector except a legitimately absent `.center-scroll`.
- **In a browser** — and this part cannot be checked any other way: the offer line appears on a first visit and not on the second, the ring lands on the section being described rather than beside it, the card does not cover the thing it is pointing at, and Escape closes the tour.
