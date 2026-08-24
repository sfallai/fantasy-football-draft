# Fantasy Football Draft Assistant

A single-file, offline browser app for a live 10-team standard-scoring snake draft.
Tracks every pick, manages the player pool, and recommends picks from a composite
of BPA, positional need, and value-based drafting.

## Draft-day checklist

Run this the morning of the draft, on a machine with internet:

```bash
npm run fetch     # refresh data/players.json from ESPN + Fantasy Football Calculator
npm run build     # regenerate draft.html
npm test          # confirm everything still passes
```

Then open `draft.html` by double-clicking it. **No internet is needed after this
point** — the page is fully self-contained.

## Using it

1. **Setup** — confirm teams/rounds/roster slots, click your draft position, enter
   any keepers (player + round). Click **Start Draft**.
2. **Every pick** — type the player's name in the box at the top of the center
   panel, arrow to the right match, press Enter. Works for other teams' picks too;
   the app always logs to whichever team is on the clock.
3. **Your pick** — the top 3 recommendations appear with a one-line "why" and any
   positional-run warnings.
4. **Mistakes** — click **Undo** to reverse the last pick.
5. **Refresh** — the draft is saved to `localStorage`, so reloading the page
   restores everything. **Reset draft** clears it and returns to setup.

## Data sources

| Field | Source |
|---|---|
| Overall rank, projected points | ESPN fantasy standard-scoring projections |
| ADP | Fantasy Football Calculator, 10-team non-PPR mock drafts |
| Bye weeks | ESPN pro-team schedule |

## Development

```bash
npm test                  # all unit tests (Node's built-in runner, no dependencies)
node scripts/build.mjs    # bundle src/ + data/ into draft.html
```

Source lives in `src/core/` (pure logic, fully unit-tested) and `src/ui/` (DOM).
`scripts/build.mjs` inlines everything into `draft.html`, so **`draft.html` is a
build artifact — never edit it by hand.**

Modules under `src/` must use only `import { a } from './rel.js';` and
`export function|const|class` — the bundler is a small regex transform and does
not understand default exports, export lists, or namespace imports.
