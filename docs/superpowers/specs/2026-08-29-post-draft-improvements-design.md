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

A player is a **rookie** when `experience !== null && experience <= 1`.

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
drafted players; abbreviation glossary.*

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

**Need suppression.** `needSummary` in `src/ui/myteam.js` omits any position
whose tier is `bench` — every starting slot there is full, so ranking it as a
need is noise. The `bench` tier itself stays in `positionalNeeds`, because
`scorePlayer` still uses it to decay surplus picks.

**Bye conflicts.** A new pure helper reports, for a candidate player, whether
drafting him would put him on the same bye week as a projected starter *at the
same position*. Cross-position collisions are not flagged: bench depth is
position-specific, so an RB and a WR sharing a bye is coverable and an RB1/RB2
collision is not. The warning renders on the recommendation card.

### E — Pick editing and backup

*Notes: edit a player cell directly instead of undoing repeatedly; survive
catastrophic loss.*

**The problem.** `currentPickNumber` returns the first *unfilled* pick. The
clock is therefore derived from where the holes are. Clearing pick 43 in a
draft that has reached pick 80 would snap the clock back to round 5 and
misroute every subsequent pick.

**The fix.** Stop deriving the clock from holes. State gains an explicit
`cursor`: the next pick to be made. It advances on `applyPick` and
`applyOffListPick`, retreats on undo, and is untouched by editing a past cell.
Clearing a past cell leaves a genuine hole, which renders as an empty cell
inside the drafted region — honest about what happened, and no longer able to
move the clock.

**Undo generalizes.** `history` entries become `{pick, previous}` rather than a
bare pick number, so undo reverses the most recent *action* — an edit as
readily as a pick.

**Migration.** A draft saved by the current version has no `cursor`.
`deserialize` derives one on load from the existing picks, so a mid-draft
reload across the upgrade does not lose the draft.

**Editing surface.** Clicking a filled board cell opens an editor for that pick
offering a player search or a clear.

Keeper cells are editable on the same terms. Keepers are written into `picks` by
`createState` at setup and are ordinary entries thereafter, so clearing one
removes that pick and leaves `config.teams[].keeper` untouched. A cleared keeper
does not reappear on reload, because `deserialize` restores `picks` as saved
rather than rebuilding them from the config.

**Backup.** A **Save backup** button writes the serialized draft to a file. An
**Import** button restores one, replacing the current draft after a
confirmation. This is prevention rather than recovery, and it is accurate,
offline, and dependency-free — which reading a photograph of the board is not.

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
