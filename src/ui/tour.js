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
    body: 'When it\'s your turn, three suggestions appear here with a line explaining each, plus a couple of longer shots. They are only shown on your own pick.',
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
