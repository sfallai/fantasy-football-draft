# Post-Draft Improvements — Design Spec

## Overview

The assistant was used for a live 2026 draft. This spec captures the changes that
draft asked for: nineteen notes, grouped into seven chunks that ship in order.

The architecture does not change. It remains a single-file, zero-dependency,
offline browser app built by `scripts/build.mjs` from `src/` and `data/`. Pure
logic stays in `src/core/` under unit test; DOM work stays in `src/ui/`.

**Source:** post-draft notes, 2026-08-29.

## Findings That Shaped the Design

Two questions were settled by investigation before designing, because both
could have invalidated a chunk.

### CORS reachability from `file://`

An in-page data refresh needs the browser to reach the upstream APIs from a
`file://` page, whose `Origin` is `null`. Measured directly:

| Endpoint | Result for `Origin: null` | Usable |
|---|---|---|
| ESPN `kona_player_info` | `ACAO: null`; preflight returns `Access-Control-Allow-Headers: x-fantasy-filter` | Yes |
| ESPN `proTeamSchedules_wl` | `ACAO: null` | Yes |
| ESPN core athletes | `ACAO: *` | Yes |
| Fantasy Football Calculator ADP | No CORS headers from any origin | **No** |

ADP therefore cannot be refreshed in the page. Chunk G refreshes everything
else and leaves ADP as baked in, stating so on screen.

### Availability of age, rookie status, and prior-season stats

`kona_player_info` returns neither age nor experience — confirmed against the
live response, whose player keys are `active, defaultPositionId,
draftRanksByRankType, droppable, eligibleSlots, firstName, fullName, id,
injured, injuryStatus, jersey, lastNewsDate, lastVideoDate, ownership,
proTeamId, rankings, seasonOutlook, stats`.

- **Prior-season points** are already in that response and currently discarded.
  Widening `filterStatsForExternalIds` to `[SEASON - 1, SEASON]` and reading the
  row with `statSourceId: 0` yields last season's actual fantasy points.
- **Games played** is derivable as `appliedTotal / appliedAverage`, rounded.
  Verified: 289.9 / 17.0529 = 17.
- **Age and experience** require `sports.core.api.espn.com/v3/sports/football/nfl/athletes/{id}`,
  one request per player. Verified to return `age` and `experience.years`.

## Data Schema Change

Three fields are added to each player record in `data/players.json`:

| Field | Type | Source | Null when |
|---|---|---|---|
| `age` | number \| null | ESPN athlete endpoint | Defenses; request failure |
| `experience` | number \| null | ESPN athlete endpoint (`experience.years`) | Defenses; request failure |
| `prior` | `{points, games, ppg}` \| null | ESPN prior-season stat row | No prior-season row |

A player is a **rookie** when `experience !== null && experience <= 1 && prior === null`.
ESPN's `experience` is not a self-consistent years-played counter on its own: the sole
`experience === 1` player in the data is a veteran who changed teams (a prior season on
record), while some genuine rookies come back with `experience === 2`. Requiring no prior
season makes the predicate correct regardless of what `experience` means in a given
response.

Cost: roughly 16KB across 400 players, against a current `draft.html` of 125KB.

The 400 extra HTTP requests run concurrency-limited in `scripts/fetch-players.mjs`.
A failed athlete request sets `age` and `experience` to `null` for that player
and never fails the run — stale ranks are recoverable, a failed fetch the
morning of a draft is not.

## Chunks

Chunks ship in the order listed. A: the schema change gates anything that
displays the new fields. B and C: the panels touched on every pick. E before F:
grading reads roster state that E reshapes.

### A — Data enrichment

*Notes: show if rookie, show player age, show last year's stats.*

`scripts/fetch-players.mjs` gains the three fields above.
`tests/players-data.test.js` validates their types and nullability. No UI yet.

### B — My Team panel

*Notes: show bye week and team in the left column; show position counts.*

Each slot row in `src/ui/myteam.js` shows the player's team and bye inline
rather than only in a `title` attribute. A count line above the needs section
reads `QB:2 RB:3 WR:3 TE:1 K:1 DEF:1`, sourced from the existing
`countByPosition`.

### C — Player list and filtering

*Notes: remove the pick-entry box; filter by team; clear-filter button; show
drafted players; abbreviation glossary; show if rookie; show player age; show
last year's stats on click.*

The last three were originally listed against chunk A. That was a decomposition
error: chunk A delivered `age`, `experience` and `prior` into the data and
explicitly rendered nothing, and no later chunk claimed their display. They land
here, because chunk C owns the player table where all three belong.

The pick-entry box and its autocomplete are removed. The filter box becomes the
single text input in the center panel and is auto-focused after each render, so
picks stay keyboard-first: type, then double-click the row.

- **Filter** matches player name **or** team abbreviation, so `CIN` surfaces a
  QB–WR stack.
- **The table lists every player, not only the undrafted.** Drafted rows are
  greyed, are not double-clickable, and show the drafting team in a new
  **Drafted By** column. Undrafted rows show an empty cell there.
- **`✕`** clears the filter.
- **`?`** opens a glossary popover defining VBD, ADP, BPA, the need tiers, and
  the bye column.
- **Rookie badge.** A compact `R` chip beside the name of any player who is a
  rookie by the rule in "Data Schema Change". The predicate lands in `src/core/`
  as a shared `isRookie(player)` rather than inline at the render site, because
  the recommendation cards want it too.
- **`Age`** becomes a column. Two digits, empty for defenses.
- **Clicking a player's name** opens a detail popover carrying last season's
  line — points, games, points per game — or saying plainly that there isn't one
  rather than showing zeroes. A rookie has no prior season, and that absence is
  itself informative.

The table now runs to ten columns (`# Player Pos Tm Age Proj VBD ADP Bye
Drafted By`) inside a centre panel whose grid track floors at 420px. It gets an
`overflow-x: auto` wrapper so the panel never drives horizontal scroll on the
page, and the name cell gets a `title` carrying the full name — the left panel's
slot rows had to learn the same lesson in chunk B, where narrowing a column
silently ellipsised 44 of 400 players with no way to recover the name.

Double-click remains the commit action, so a stray single click cannot burn a
pick.

This changes what the center panel is given. `renderCenter` currently receives
only the available pool. It will receive both:

- `pool` — available players, with VBD. Feeds recommendations and sleepers.
- `tablePlayers` — every player, with VBD and an `ownerName` field (`null` when
  undrafted). Feeds the table only.

Recommendations must never consider a drafted player, which this separation
guarantees structurally rather than by filtering at the point of use.

### D — Recommendations

*Notes: position targeting; dark horse list; stop nagging about filled
positions; flag bye-week conflicts.*

**Position targeting.** The existing position button row (`ALL QB RB WR TE K
DEF`) becomes multi-select and does double duty: the selected positions filter
the table *and* restrict the top-3 recommendations to those positions. One
control, matching how the note was written. The cost is that browsing kickers
while holding WR recommendations is not possible; that is accepted.

`ALL` is not a selectable member of the set — it is the clear button, and
clicking it deselects every position. Selecting a position deselects `ALL`. An
empty selection is treated as `ALL` rather than as an empty board, so the
recommendations can never render blank.

**Sleepers.** A separate panel below the recommendations lists two or three
players, labeled as gambles rather than mixed into the main recommendations. A
player qualifies when either:

- **Falling** — his ADP is at least `SLEEPER_ADP_GAP` picks earlier than the
  current pick, meaning the market expected him gone. Starting value: 15 picks,
  set clear of the existing `ADP_VALUE_GAP` of 8 so a sleeper is a stronger
  claim than the "Value" reason already shown on recommendation cards. A player
  with a null ADP never qualifies on this test.
- **Out-projecting his rank** — his projected points exceed the median of the
  `SLEEPER_RANK_BAND` overall ranks surrounding him by at least
  `SLEEPER_PROJECTION_EDGE`. Starting values: a band of 20 ranks, an edge of 15
  points.

Both thresholds are exported constants, tuned against the shipped pool the way
`CLIFF_THRESHOLD` and `ADP_VALUE_GAP` already are. Sleepers are drawn from the
available `pool`, respect position targeting, and exclude anyone already in the
top-3 recommendations — a player cannot be both the safe pick and the gamble.

**Need suppression.** A position whose startable slots are all full stops being
*ranked* among your needs, but keeps its row as a confirmation. `needSummary` in
`src/ui/myteam.js` still returns all six positions; a `bench`-tier entry is
marked `set`, labelled plainly (`QB set`), sorted below every unset entry, and
rendered without a tier chip.

Dropping the row entirely was the first design, and it was wrong: it removed the
one place that told you a position was handled. Sorting it out of the ranking is
what the note asked for — stop telling me to prioritise it — while "QB set" still
answers "do I have a quarterback?" at a glance.

A `set` row sorts below even `none`, because `none` on a K or DEF is a need you
have not reached yet, while `set` is finished. The `bench` tier itself stays in
`positionalNeeds`, because `scorePlayer` uses it to decay surplus picks.

**Bye conflicts.** A new pure helper reports, for a candidate player, whether
drafting him would put him on the same bye week as a projected starter *at the
same position*. Cross-position collisions are not flagged: bench depth is
position-specific, so an RB and a WR sharing a bye is coverable and an RB1/RB2
collision is not. The warning renders on the recommendation card.

### E — Pick editing and backup

*Notes: edit a player cell directly instead of undoing repeatedly; survive
catastrophic loss.*

**Editing a cell replaces its player. It never empties it.** That one
restriction is what keeps this chunk small, and it costs nothing real.

**Why the restriction.** `currentPickNumber` returns the first *unfilled* pick,
so the clock is derived from where the holes are — an invariant the whole app
rests on, with two dozen tests pinned to it. Replacing the player at pick 43
leaves pick 43 filled and moves nothing. *Clearing* it back to empty would put a
hole in the middle, make "first unfilled pick" mean the wrong thing, and force an
explicit cursor, a migration for mid-draft saves, and rework of every one of
those tests.

**Why clearing was dropped rather than deferred.** Working through when a user
would actually want an empty cell:

- *Logged the wrong player* — that is a replace, which this chunk does.
- *Logged a pick that never happened* — clearing leaves a hole and shifts
  nothing, so it does not fix this either. That would need a delete-and-shift,
  which was never specified.
- *Do not know who was taken* — clearing leaves a hole, which says "not yet
  picked": a worse lie than a wrong name, and one the clock believes. The honest
  mark is the off-list sentinel, which keeps the cell filled. Note that the **Skip
  / off-list** button does *not* cover this on its own, as an earlier draft of this
  section claimed: `applyOffListPick` reads `currentPickNumber`, so it only ever
  applies to the pick on the clock, and once pick 13 exists pick 12 can no longer be
  marked. The pick editor therefore offers an **Unknown / off-list** entry, which
  writes `` `${OFF_LIST_PREFIX}${pick}` `` into whichever cell is being edited.
  Retroactive, and still not a hole.

Replace plus off-list — at the clock from the button, retroactively from the
editor — covers every case clearing would, and clearing was the sole reason the
state model had to change. It is not deferred
scope; it is a feature that does not do a job. If a real case ever turns up, the
cursor work can be justified by that example instead of by speculation.

**What changes.**

- `setPick(state, pickNumber, playerId)` replaces the player at an
  already-filled pick. It refuses an unfilled pick — that is what the normal flow
  is for. `currentPickNumber` is untouched.
- **The swap case.** Naming a player who already sits at another pick *exchanges*
  the two entries rather than rejecting them: pick A takes B's player and pick B
  takes A's. Two picks logged in the wrong order is an ordinary draft-day mistake
  and had no expression at all — `setPick` threw `already drafted`, and clearing
  would not have helped either, because it moves the clock backwards. Every pick in
  `state.picks` is filled by definition, so an exchange fills exactly the cells it
  empties: no hole, no clock movement, no invariant change. `teamIndex` and
  `isKeeper` stay with their pick numbers — an exchange must never move a pick to
  another manager — and the whole exchange is one `history` entry, so one undo
  reverses both halves. The editor's pool therefore includes drafted players, each
  labelled with the pick that holds him (`Bijan Robinson — swap with pick 12`), so
  the exchange is never a surprise.
- `history` entries become `{pick, previous}` rather than a bare pick number, so
  undo reverses the most recent *action* — an edit as readily as a pick.
- **Migration:** a draft saved by an earlier version has `history` as a plain
  array of pick numbers. `deserialize` normalises both shapes, so a mid-draft
  reload across the upgrade keeps working. This is the only migration.

**Editing surface.** Clicking a filled board cell opens an editor for that pick
with a player search. Keeper cells edit on the same terms: keepers are written
into `picks` by `createState` at setup and are ordinary entries thereafter, so
replacing one changes the pick and leaves `config.teams[].keeper` alone.

The editor is the first *interactive* popover. Chunk C's `src/ui/popover.js`
dismisses on a click outside the open node rather than on any click, and chunk D
made `renderCenter` close popovers on re-render — both are prerequisites this
chunk depends on and neither needs revisiting.

**Backup.** A **Save backup** button writes the serialized draft to a file. An
**Import** button restores one, replacing the current draft after a
confirmation, and must call `resetView()` — otherwise an imported draft silently
inherits the previous draft's position targeting and filtered recommendations.
Backup touches no state-model logic at all.

This is prevention rather than recovery, and it is accurate, offline, and
dependency-free — which reading a photograph of the board is not.

### F — Grading and end of draft

*Notes: live team grade; end-draft summary with grades and finish order;
richer column-header popover.*

A new `src/core/grade.js`:

- **Strength** = the summed projected points of a team's best legal starting
  lineup, reusing `assignSlots` and ignoring bench slots. It measures what
  actually scores.
- **Grade** = strength z-scored across the league, curved to letters. Relative
  by construction, so it is meaningful from the first round even though the
  rosters are empty.

Bands, by standard deviations from the league mean, upper bound exclusive:

| z | Grade | z | Grade |
|---|---|---|---|
| >= 1.5 | A+ | -0.25 to 0.0 | C+ |
| 1.0 to 1.5 | A | -0.5 to -0.25 | C |
| 0.75 to 1.0 | A- | -0.75 to -0.5 | C- |
| 0.5 to 0.75 | B+ | -1.0 to -0.75 | D+ |
| 0.25 to 0.5 | B | -1.5 to -1.0 | D |
| 0.0 to 0.25 | B- | < -1.5 | F |

When every team has identical strength — most obviously before the first pick —
the standard deviation is zero. Every team then grades `C+` rather than the
implementation dividing by zero.

Grades render beside each team name on the board header. The header popover
becomes: slot layout, then that team's picks as a table, then their grade.

An **End Draft** button opens a summary ranking every team 1..N by strength,
with grade and projected points. The ranking is presented as a preseason
projection ordering, not a predicted final standing, and no win-loss record is
invented — the schedule is not in the data.

### G — Refresh button

*Note: button to refresh the player list on draft day.*

A **Refresh data** button fetches from ESPN and updates `projectedPoints`,
`overallRank`, `positionRank`, `team`, and `bye`.

- **ADP is not refreshed** and stays as baked in, because FFC is unreachable
  from the browser. The UI says so rather than implying a full refresh.
- **`age`, `experience`, and `prior` are not refreshed.** They do not change
  during a season, and refreshing them would mean 400 requests from the page.
- **VBD baselines and the VBD scale are recomputed** after a refresh. Both are
  derived from the pool at draft start and would otherwise be stale.
- **Any player already on a roster is preserved** even if he falls out of the
  new top 400, so a refresh can never orphan a pick.

Two traps in this chunk, both found while implementing chunk A and recorded here
because neither is visible from chunk G's own code.

**A refresh must merge, not rebuild.** `age`, `experience`, and `prior` come from
responses that the in-page refresh does not make — that is the finding which
justified chunk A in the first place. A refresh that rebuilds each record from a
fresh `kona_player_info` response therefore sets all three to `null` for every
player, and **no existing test catches it**: the schema test reads
`data/players.json`, not the in-page refresh result, and `null` is a legal value
for all three fields. Chunk G needs an explicit test that a refresh preserves
`age`, `experience`, and `prior` on every player it touches.

**One existing test will fail the moment chunk G lands.** `tests/build.test.js`
asserts `doesNotMatch(html, /\bfetch\s*\(/, 'no network access at runtime')`
against the built page. Chunk G puts `fetch(` into `src/`, so that assertion
breaks by design. It encodes a real invariant, so narrow it rather than delete
it: the page must remain offline *by default*, reaching the network only on an
explicit click.

**`experience` is a rookie flag, not a career length.** ESPN counts the current
rookie class as 0 and the previous one as 2, so any later feature tempted to
render "3rd-year WR" from this field would be off by one for a whole draft class.
Deriving the rookie badge is all this field supports.

## Carried forward from chunk D

**Chunk E's import path must call `resetView()`.** `view` (sort key, targeted positions,
query, available-only) is module state in `src/ui/center.js`, cleared today only by
`handleReset`. An imported draft that skipped it would silently inherit the previous
draft's position targeting — and therefore its filtered recommendations.

**`SLEEPER_ADP_GAP` of 15 fires rarely in a tight draft.** Simulating against the shipped
pool, a room that deviates only a few picks from ADP produced at most three qualifying
fallers across 160 picks. The threshold was set by reasoning, not by data, and deserves
revisiting against a real draft log rather than a simulation.

**A sleeper's projection edge is static; its ADP fall is dynamic.** That asymmetry is why
the panel reserves one slot per qualification kind rather than ranking both on one scale —
without it, one near-static outlier holds a slot at every pick of every draft. Anything
later that touches sleeper selection needs to keep that property.

## Carried forward from chunk C

Two things the chunk C review surfaced that later chunks will meet.

**`renderCenter` does not close an open popover on re-render.** `renderBoard` calls
`closePopover()` at the top of every render; `renderCenter` does not. A pick-driven
re-render can therefore leave a detail or glossary popover on screen pointing at DOM
that has been replaced. Harmless today because both are read-only, but chunk E's pick
editor is interactive and must not survive the render it triggered.

**`.tablewrap`'s `max-height: calc(100vh - 320px)` is tuned to the chrome that sits
above the table today** — pick info, control bar, recommendations, filters. Chunk D adds
a sleepers panel above it and will need to revisit the constant, or replace it with a
layout that does not hardcode one.

## Deferred: distribution to non-technical users

Recorded 2026-08-30, after chunks A and B shipped. Not yet specced.

The app is intended for people other than its author, who are **not technical** —
for them a terminal is a non-starter. That is a requirement change, not a
preference, and it reaches further than any one chunk:

- The README's draft-day sequence (`npm run fetch && npm test && npm run build`)
  assumes a shell. For these users every recovery path has to live in the page.
- Chunk G's refresh button stops being a convenience and becomes the only way
  they ever get fresh data.
- An **AWS Lambda Function URL** in front of the data sources is the likely
  answer, and the strongest argument for it is not CORS. It is that a proxy
  **decouples the shipped `draft.html` from upstream API drift**: when ESPN
  changes a response shape, you redeploy a function instead of redistributing a
  file to people who do not know what a file is. Use a Function URL rather than
  API Gateway — Lambda invocations and Function URLs are always-free tier, while
  API Gateway's free tier expires after twelve months.
- Whatever is built, the baked-in 400-player data stays the floor, so a dead
  proxy degrades to stale rankings rather than a broken app. "No internet needed"
  is what makes this work at a live draft on bad wifi.

Open questions for that spec: whether the public Function URL needs a shared
secret, how people receive the file, and what the setup screen may assume about
whoever is filling it in.

Chunks C through F are local UI work and are unaffected either way.

## Testing

Unchanged in approach. Logic lands in `src/core/` and is unit-tested directly;
`src/ui/` helpers that are pure — `sortPlayers`, `filterByPosition`,
`needSummary`, `boardCells` — keep their direct tests. New modules (`grade.js`,
the bye-conflict helper, sleeper selection) are tested the same way.

`npm test` must pass before `npm run build`, as the draft-day sequence in the
README already requires.

## Out of Scope

- **OCR of a photographed draft board.** It would mean inlining an OCR engine —
  megabytes of wasm in a file that is meant to be self-contained and
  dependency-free — and would still misread handwriting. Backup and import
  solve the actual problem, which is not losing the draft.
- **Projected win-loss records.** The schedule is not in the data, and a
  round-robin assumption would present invented numbers with unearned
  confidence.
- **Refreshing ADP in the page.** Blocked by FFC's lack of CORS headers.
  `npm run fetch` remains the way to update ADP.
