# Fantasy Football Draft Assistant

A single-file, offline browser app for a live 10-team standard-scoring snake draft.
Tracks every pick, manages the player pool, and recommends picks from a composite
of BPA, positional need, and value-based drafting.

## Draft-day checklist

**Refreshing the data is optional.** A working `draft.html` with a known-good
400-player file is already committed — you can double-click it and draft without
ever running any of this. Skip straight to *Using it* if you want.

If you do want fresher rankings, run this the morning of the draft, on a machine
with internet, **in this order**:

```bash
npm run fetch     # refresh data/players.json from ESPN + Fantasy Football Calculator
npm test          # validate the new data BEFORE it is baked into the page
npm run build     # regenerate draft.html
```

`npm run fetch` overwrites `data/players.json` in place, so it has to be validated
before `build` bakes it in. If the tests fail — or anything about the new data looks
wrong — restore the committed file and rebuild from that:

```bash
git checkout data/players.json
npm run build
```

`npm run fetch` now makes roughly 400 requests (one per skill-position player, to fetch
age and experience) instead of 3, so it takes appreciably longer — expect it to run for a
while, with periodic `...N/M athlete lookups done` progress lines so it doesn't look hung.
If a test complains about age, prior-season, or rookie coverage being too low, that means
the age/experience/prior-season lookups mostly failed or came back in an unexpected shape
— it is not safe to draft from that data. `git checkout data/players.json` as above and
rebuild from the known-good file.

Requires **Node 22 or newer** (the test script relies on the runner's own glob
expansion). Then open `draft.html` by double-clicking it — **Chrome is recommended**
for draft day. **No internet is needed after this point** — the page is fully
self-contained.

## Using it

1. **Setup** — confirm teams/rounds/roster slots, click your draft position, enter
   any keepers (player + round). Click **Start Draft**.
   - The **Teams** field commits on blur, which is what redraws the team table and
     the draft-position buttons. Clicking **Start Draft** blurs it first, so the
     change is picked up — but **check by eye** that the team table shows the number
     of rows you expect before starting. (If it did not commit you get a "Team
     entries … do not match" error rather than a wrong draft.) Tabbing out of the
     field first always works.
   - A keeper needs **both** a player and a round. Half a keeper is rejected with an
     error naming the team.
2. **Every pick** — type the player's name in the box at the top of the center
   panel, arrow to the right match, press Enter. Works for other teams' picks too;
   the app always logs to whichever team is on the clock.
3. **Someone drafts a player who isn't in the list** — a rookie, a handcuff, an
   injured stash. Click **Skip / off-list** to consume that pick slot. The board
   shows an em-dash for it. If you don't, every later pick lands on the wrong pick
   number and the wrong team.
4. **Your pick** — the top 3 recommendations appear with a one-line "why" and any
   positional-run warnings.
5. **Mistakes** — click **Undo** to reverse the **most recent** pick only. There is
   no "edit pick N": to correct an earlier pick, undo back to it and re-enter the
   picks after it.
6. **Refresh** — the draft is saved to `localStorage`, so reloading the page
   restores everything. **Reset draft** clears it and returns to setup.
   - If browser storage is unavailable (a private window, blocked site data, a full
     quota) a banner above the panels reads **"Draft is NOT being saved — do not
     refresh this page."** Take that literally: a refresh would lose the draft.

## Data sources

| Field | Source |
|---|---|
| Overall rank, projected points | ESPN fantasy standard-scoring projections |
| ADP | Fantasy Football Calculator, 10-team non-PPR mock drafts |
| Bye weeks | ESPN pro-team schedule |
| Age, experience | ESPN athlete endpoint (`sports.core.api.espn.com`), one request per player |
| Prior-season points, games, ppg | ESPN fantasy projections response, last season's actuals |

## Development

```bash
npm test                  # all unit tests (Node's built-in runner, no dependencies)
node scripts/build.mjs    # bundle src/ + data/ into draft.html
```

Node >= 22 (see `engines` in `package.json`). There are no npm dependencies, and
there never will be — `npm install` is not part of any workflow here.

Source lives in `src/core/` (pure logic, fully unit-tested) and `src/ui/` (DOM).
`scripts/build.mjs` inlines everything into `draft.html`, so **`draft.html` is a
build artifact — never edit it by hand.**

Modules under `src/` must use only `import { a } from './rel.js';` and
`export function|const|class` — the bundler is a small regex transform and does
not understand default exports, export lists, or namespace imports.
