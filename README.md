# Fantasy Football Draft Assistant

## → https://sfallai.github.io/fantasy-football-draft/

Open that link. There is nothing to install, download, or set up.

A browser app for a live standard-scoring snake draft — 4 to 16 teams, any roster
shape. It tracks every pick, manages the player pool, recommends who to take, and
writes you a report card when the draft is over.

The player data refreshes itself every morning, so the page is current whenever you
open it — the date it was last checked is shown at the bottom of the screen. Once the
page has loaded it keeps working even if your connection drops mid-draft.

**First time?** The app offers you a guided tour on the setup screen, and there is a
**Show me around** button on both screens if you want it later. The short version:
confirm the league settings, click your draft position, add any keepers, press
**Start Draft**, then type a name into the filter box and double-click the player as
each pick happens — including other teams' picks.

## What it does

**While you draft**

- **Recommendations** — the top three available players, each with a one-line reason:
  a positional cliff, a need it fills, or how far past its ADP it has fallen. Plus a
  couple of longer shots kept deliberately separate, so a flier can never displace the
  best player on the board.
- **Will he last?** — for each recommendation, whether he is likely to still be there
  at your next pick, from the spread of where he actually goes across thousands of
  real drafts. Shown as a plain reading ("Likely gone by 10.08"), never a percentage,
  and it says nothing at all when the data cannot support an answer.
- **Handcuffs** — a filter for the backups to your own starting running backs, from
  the real NFL depth charts, and a note when a recommendation's own backup is still
  available.
- **Stacks** — a note when a player shares an NFL team with someone you already own
  (a quarterback and a pass-catcher, not two running backs).
- **Bye clashes** — a warning when a player is off the same week as one of your
  starters at the same position.
- **Positional runs** — a note when several teams picking before your next turn all
  need the same position and the startable players there are running out.
- **The board** — every pick in the draft, colour-coded, with a live letter grade on
  each team. Click a team name for its roster; click any filled square to correct it.
- **Filters** — by position (multi-select), by name or NFL team, available-only, and
  handcuffs. Position filters drive the recommendations too, so you can ask "who is
  the best receiver here?".

**When it goes wrong**

- **Undo** reverses the last pick. To fix an *earlier* one, click its square on the
  board and pick the right player — choosing someone already drafted swaps the two,
  which is how a transposed pair gets fixed.
- **Skip / off-list** consumes a pick for a player who is not in the list at all.
- **Save backup / Import backup** writes the whole draft to a file and reads it back,
  on any machine. The draft is also saved to browser storage automatically.

**When it is over**

- **A report card** — every team ranked with a letter grade, then what is still on
  waivers, the biggest steals and reaches against ADP, where the league was
  collectively wrong about a position, the earliest picks that never make a lineup,
  and a note on each team with its starting spine and bye-week clashes.
- **Export** — the board as a CSV (one row per pick, for a spreadsheet), or the
  report card and the board as PDFs via your browser's print dialog.

Every sentence on the screen states something the app computed. Where a fact is not
available it says nothing rather than guessing, and nothing anywhere predicts a
finish or a win-loss record — the schedule is not in the data.

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

`npm run fetch` now makes roughly 430 requests — one per skill-position player for age
and experience, plus one per NFL team for the depth charts — instead of 3, so it takes
appreciably longer — expect it to run for a
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
2. **Every pick** — type part of the player's name or NFL team into the filter box,
   then **double-click** his row in the list below. Works for other teams' picks too;
   the app always logs to whichever team is on the clock.
3. **Someone drafts a player who isn't in the list** — a rookie, a handcuff, an
   injured stash. Click **Skip / off-list** to consume that pick slot. The board
   shows an em-dash for it. If you don't, every later pick lands on the wrong pick
   number and the wrong team.
4. **Your pick** — the top 3 recommendations appear with a one-line "why" and any
   positional-run warnings.
5. **Mistakes** — **Undo** reverses the most recent pick. To correct an *earlier*
   one, click its square on the board and choose the right player. Picking someone
   who is already drafted **exchanges** the two picks, which is how you fix a
   transposed pair. A cell is never left empty — if you genuinely do not know who
   went there, use **Skip / off-list**, which keeps the cell filled so every later
   pick still lands on the right team.
6. **Refresh** — the draft is saved to `localStorage`, so reloading the page
   restores everything. **Reset draft** clears it and returns to setup.
   - If browser storage is unavailable (a private window, blocked site data, a full
     quota) a banner above the panels reads **"Draft is NOT being saved — do not
     refresh this page."** Take that literally: a refresh would lose the draft.

## Data sources

| Field | Source |
|---|---|
| Overall rank, projected points | ESPN fantasy standard-scoring projections |
| ADP, and its spread | Fantasy Football Calculator non-PPR mock drafts. The request asks for 10 teams but the API returns its 12-team, 15-round sample regardless — verified, `teams=10` and `teams=12` come back byte-identical. ADP is an overall **pick number** and is roughly league-size independent, so it is never rescaled by team count. |
| Depth-chart rank, backups | ESPN team depth charts (`sports.core.api.espn.com`), one request per NFL team |
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
not understand default exports, export lists, or namespace imports. A violation
produces a silently broken page rather than a failing build.

### Where things live

| Area | Module |
|---|---|
| Value-based drafting, replacement level | `src/core/vbd.js` |
| Recommendation scoring, reasons, sleepers | `src/core/recommend.js` |
| Roster slots, needs, bye conflicts | `src/core/roster.js` |
| Team grades | `src/core/grade.js` |
| End-of-draft report card | `src/core/report.js`, `src/core/teamnotes.js` |
| Handcuffs | `src/core/handcuff.js` |
| Availability odds | `src/core/odds.js` |
| Stacks | `src/core/stack.js` |
| CSV export | `src/core/csv.js` |
| Draft state, persistence, backups | `src/core/state.js` |
| Guided tour | `src/ui/tour.js` |

### One thing the tests cannot do

`tests/dom-stub.js` is a hand-written stand-in for the DOM with **no layout engine
and no CSS engine**. It can tell you which nodes and text exist and nothing more, so
no test here can see whether anything *looks* right. A `flex-basis` bug once collapsed
the recommendations panel to about 13px with the whole suite green, and it was found
mid-draft. Anything that touches layout or CSS needs a human to open the page.
