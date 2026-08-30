# Fantasy Football Draft Assistant

## → https://sfallai.github.io/fantasy-football-draft/

Open that link. There is nothing to install, download, or set up.

A browser app for a live 10-team standard-scoring snake draft. It tracks every pick,
manages the player pool, and recommends who to take from a composite of best-player-
available, what your roster still needs, and value-based drafting.

The player data refreshes itself every morning, so the page is current whenever you
open it — the date it was last checked is shown at the bottom of the screen. Once the
page has loaded it keeps working even if your connection drops mid-draft.

**First time?** Confirm the league settings, click your draft position, add any
keepers, and press **Start Draft**. Then type a name into the filter box and
double-click the player as each pick happens — including other teams' picks.

---

*Everything below is for maintaining the app, not using it.*

## Draft-day checklist

**Refreshing the data is optional.** A working `draft.html` with a known-good
400-player file is already committed — you can double-click it and draft without
ever running any of this. Skip straight to *Using it* if you want.

If you do want fresher rankings, run this the morning of the draft, on a machine
with internet, **in this order**:

```bash
npm run fetch     # refresh data/players.json and data/fetched-at.json
npm run build     # regenerate draft.html from the new data
npm test          # validate — including the data now baked into draft.html
```

This is fetch, then build, then test — not the more intuitive fetch-then-test.
`npm run fetch` also rewrites `data/fetched-at.json` (the "as of" stamp), and every
run changes it, whether or not any player moved. Testing between the fetch and the
rebuild compares a `draft.html` still carrying the *old* stamp against data carrying
the *new* one and fails every single time on that mismatch alone — a false alarm that
looks exactly like a real one. Nothing is lost by testing last: the checks that catch
bad upstream data (coverage floors for projections, age, ADP, prior season, rookies)
read `data/players.json` directly, not the bundle, so they still fail before you ship
if the fetch actually broke something. This is also the order CI runs in.

`npm run fetch` overwrites `data/players.json` and `data/fetched-at.json` in place,
so they have to be validated before you rely on them. If the tests fail — or
anything about the new data looks wrong — restore both committed files together and
rebuild from those:

```bash
git checkout data/players.json data/fetched-at.json
npm run build
```

Restoring only `data/players.json` leaves the *new* fetch's timestamp in place over
the *old* fetch's data — the page would then claim the rankings are as fresh as
today's failed run, when they are really as old as the last good one.

`npm run fetch` now makes roughly 400 requests (one per skill-position player, to fetch
age and experience) instead of 3, so it takes appreciably longer — expect it to run for a
while, with periodic `...N/M athlete lookups done` progress lines so it doesn't look hung.
If a test complains about age, ADP, prior-season, or rookie coverage being too low, that
means the corresponding lookups mostly failed or came back in an unexpected shape — it is
not safe to draft from that data. `git checkout data/players.json data/fetched-at.json` as
above and rebuild from the known-good files.

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
