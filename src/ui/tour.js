import { el, clear } from './dom.js';

export const TOUR_SEEN_KEY = 'ffdraft.tour.seen.v1';

// Five steps, in the order someone actually fills the screen in.
export const SETUP_STEPS = [
  {
    anchor: '[data-tour="league"]',
    title: 'Your league',
    body: 'How many teams, and how many rounds. The defaults match a standard ten-team, fifteen-round draft, so most people change nothing here. Scoring and draft type are fixed: standard non-PPR, snake.',
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
    body: 'Every team in the league, yours included; yours is the row numbered with the slot you picked a moment ago. Name them if you like, and add any keepers with the round they cost; a keeper needs both.',
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
    body: 'Type any part of a name or a team into the box, then double-click the player in the list below. Do this for every pick, including other teams — the app follows the whole draft, not just yours. In the bar above, Undo takes back a mistype and Skip / off-list covers a player this list does not have.',
  },
  {
    anchor: '.center-scroll',
    title: 'What to take',
    body: 'When it\'s your turn, three suggestions appear here with a line explaining each, plus a couple of longer shots. They are only shown on your own pick.',
  },
  {
    anchor: '.panel.left',
    title: 'Your roster',
    body: 'Your lineup as it fills, what you still need, and how many you hold at each position — covered ones drop out of the ranking. Lower down in this panel: reset, end the draft, and Save backup / Import backup. A draft lives in this one browser, so that file is the only way to move or rescue it.',
  },
  {
    anchor: 'table.board',
    title: 'The board',
    body: 'Every pick in the draft. Click any filled square to correct the player in it, or a team name at the top to see their roster and grade.',
  },
  {
    anchor: '.btn-end-draft',
    title: 'Afterwards',
    body: 'When the draft is over, every team is graded and ranked. Below that: who is left on waivers, the biggest steals and reaches against ADP, where the league was wrong about a position, and a note on each team.',
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

// The ring and the dim are one element: a transparent box outlined around the target,
// carrying a spread large enough to darken the rest of the page. Two elements would need
// four rectangles to cut a hole, and they would disagree at the corners.
const RING_PAD = 6;

// Neither `window` nor the addEventListener/removeEventListener methods on it are
// modelled by the test stub, so every touch of them is guarded rather than assumed.
function on(target, type, handler, options) {
  if (target && typeof target.addEventListener === 'function') target.addEventListener(type, handler, options);
}
function off(target, type, handler, options) {
  if (target && typeof target.removeEventListener === 'function') target.removeEventListener(type, handler, options);
}

// One tour open at a time, exactly like popover.js's openNode: a second call closes
// whatever the first left open rather than stacking a second overlay and a second
// keydown listener on top of it.
let openClose = null;

// Nothing else knows whether a tour is up. `render()` calls this before drawing a
// new screen, because a tour describing the screen you just left — a ring at the old
// Start Draft's coordinates, a card reading "5 of 5" — is worse than no tour at all.
// A no-op when none is open, so callers never have to ask first.
export function closeTour() {
  if (openClose) openClose();
}

// `onClose` runs after the tour is fully torn down, however it ended: Done, Skip,
// Escape, or superseded by another tour. Optional — the draft screen has nothing to
// do afterwards, and omitting it must stay valid.
export function startTour(steps, doc = document, onClose = null) {
  if (openClose) openClose();

  const tour = createTour(steps);
  const layer = el('div', { class: 'tour-layer' }, []);
  doc.body.appendChild(layer);
  const win = typeof window !== 'undefined' ? window : null;

  let closed = false;

  function close() {
    // Skip, Done, Escape and a screen change can all arrive for the same tour, and
    // `onClose` re-renders — running twice would re-render twice.
    if (closed) return;
    closed = true;
    markTourSeen();
    // Every trace of the tour goes BEFORE the callback. `onClose` re-renders the
    // screen and may itself reach closeTour(); clearing `openClose` first is what
    // stops that recursing, and unmounting first is what stops a throw inside the
    // callback from leaving an orphaned overlay pinned over the page.
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    // Before the listeners come off, so a frame queued by the scroll that is closing
    // the tour cannot fire into a torn-down layer.
    cancelPending();
    off(doc, 'keydown', onKey);
    off(win, 'resize', onReposition);
    off(doc, 'scroll', onReposition, true);
    if (openClose === close) openClose = null;
    if (typeof onClose === 'function') onClose();
  }

  function onKey(e) {
    if (e && e.key === 'Escape') close();
  }
  // `.tour-layer` is pointer-events: none, so clicks reach the page underneath —
  // someone can act on the very thing a step is describing (e.g. record a pick) and
  // re-render the app mid-tour, leaving the ring measured against a node that no
  // longer exists. Re-measuring on resize and scroll keeps it honest without ever
  // blocking that click-through, which is worth more than a perfectly stable ring.
  //
  // Coalesced into one frame because the listener is capture-phase on the document:
  // it sees every scroll from every scroller, and the player table and teams list
  // both scroll heavily, while draw() is a full teardown, rebuild, forced layout and
  // scrollIntoView — which can itself fire the scroll event that re-enters draw().
  // requestAnimationFrame is no more modelled by the test stub than addEventListener
  // is, so it gets the same guard and the same direct fallback.
  let frame = null;
  function onReposition() {
    if (!win || typeof win.requestAnimationFrame !== 'function') { draw(); return; }
    if (frame !== null) return;
    // Cleared after draw(), not before: draw() calls scrollIntoView, and the scroll
    // event that fires from it must land inside this frame rather than queue another.
    frame = win.requestAnimationFrame(() => { draw(); frame = null; });
  }
  function cancelPending() {
    if (frame === null) return;
    if (win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame);
    frame = null;
  }

  on(doc, 'keydown', onKey);
  on(win, 'resize', onReposition);
  on(doc, 'scroll', onReposition, true);

  function draw() {
    clear(layer);
    const step = tour.step();
    if (!step) { close(); return; }

    // A missing anchor is expected, not exceptional — see the suggestions step.
    const target = doc.querySelector ? doc.querySelector(step.anchor) : null;
    // Accurate but off-screen is as unhelpful as missing — table.board scrolled down,
    // or .panel.left overflowing. Not modelled by the test stub, hence the guard.
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const box = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
    // Decided once, used twice. `.center-scroll` exists on every draft render but is
    // EMPTY whenever it is not your pick — panel width, zero height — and a ring
    // around that is a thin box drawn around blank space. Two separate guards on
    // `box && box.width` could also drift apart into a ring with a centred card.
    const hasRing = Boolean(box && box.width > 0 && box.height > 0);

    if (hasRing) {
      layer.appendChild(el('div', {
        class: 'tour-ring',
        style: {
          left: `${box.left - RING_PAD}px`, top: `${box.top - RING_PAD}px`,
          width: `${box.width + RING_PAD * 2}px`, height: `${box.height + RING_PAD * 2}px`,
        },
      }, []));
    } else {
      // Nothing to cut a hole around, so dim the whole page and centre the card.
      layer.appendChild(el('div', { class: 'tour-dim' }, []));
    }

    layer.appendChild(el('div', { class: hasRing ? 'tour-card' : 'tour-card centred' }, [
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

  openClose = close;
  draw();
  return close;
}
