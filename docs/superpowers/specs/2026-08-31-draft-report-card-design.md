# Draft Report Card — Design Spec

## Overview

Chunk F shipped an end-of-draft summary: ten teams, a letter grade, projected starter
points. This chunk expands it into something worth reading after the draft rather than
glancing at — what was stolen, what was reached for, who nobody took, and where the
whole league was wrong.

**Chunk I of the post-draft backlog.** Prompted by a report card generated outside the
app, which turned out to be almost entirely reproducible from data the app already holds.

## Why this is smaller than it looks

Nearly every input already exists:

| Section | What it needs | Where it already lives |
|---|---|---|
| Still on waivers | best undrafted players | `availablePlayers` in `state.js` |
| Biggest steals / reaches | pick number minus ADP | the same arithmetic `sleepers` already does |
| The league's blind spot | replacement level per position | `replacementPoints` in `vbd.js` |
| Per-team bye clashes | shared byes among starters | `byeConflict` in `roster.js` |
| Each team's spine | the best legal starting lineup | `assignSlots` in `roster.js` |

Two measurements taken before writing this:

- **ADP covers 157 of the top 160 players**, so steals and reaches are computable for
  essentially every pick in a ten-team, sixteen-round draft. The three without ADP are
  simply omitted rather than guessed at.
- `replacementPoints` already produces `QB 288.3, RB 167.0, WR 141.7, TE 104.0` — the same
  figures the external report quoted, to the decimal.

## The grading change, which stands on its own

**Kickers and defenses come out of the grade.**

Chunk F defines strength as the projected points of the whole best legal starting lineup,
kicker and defense included. A kicker projects around 171 points against a mid-draft
league spread of 100–150, so drafting one early *raises your grade by up to two letters* —
while the recommendation panel two feet away tells you to wait. Measured: a team taking a
K in round 8 and a DEF in round 9 went from rank 3 (`A`) to rank 1 (`A+`) and held it for
three rounds, on the kicker alone.

The two panels currently give opposite advice, by construction. Excluding K and DEF fixes
it at the source: they are worth real points and no draft capital, so counting them
rewards spending capital where it buys nothing.

**There is no separate penalty term.** An external description of this idea called for
"a penalty for roster spots that can never produce a starting-lineup point". The effect is
right but a distinct penalty needs a constant nobody can defend. Excluding K/DEF already
delivers it: a wasted pick contributes nothing, and contributing nothing *is* the penalty.
A team that spent four picks on kickers scores exactly as if it had not drafted at all in
those rounds, which is the truth.

**Open decision for implementation:** whether bench players at FLEX-eligible positions
contribute at a discount, since they genuinely cover byes and injuries. Doing so needs a
discount factor, which is another undefendable constant. Recommend starting without it —
starters only — and revisiting if grades cluster.

## What gets built

The summary screen grows four sections below the existing ranking.

**Still on waivers.** The best undrafted players by projection, with their overall rank.
The single most useful thing on the page for the ten minutes after a draft.

**Biggest steals.** Players taken furthest *after* their ADP, with the team and round.
Negative numbers, largest first.

**Biggest reaches.** The mirror: taken furthest *before* ADP.

**The league's blind spot.** Positional analysis against replacement level: which
positions had startable players go undrafted, and how many teams spent early picks on
backups who cannot start. Computed, not editorial.

**Per-team notes.** For each team, its spine (the starting core by name), and any flaws
that are computable: starters sharing a bye week, and picks taken furthest from ADP.

## The boundary this spec will not cross

The report that prompted this reads, in places, like a person wrote it — *"the cleanest
sixteen rounds anyone ran"*, *"whoever claims Love first wins the night after the night"*.

**The app will not attempt that, and should not.** It can assemble sentences from computed
facts — "six starters share a Week 10 bye", "taken 45 picks before ADP", "four startable
quarterbacks went undrafted" — and those are genuinely useful. Prose that reads as
judgement rather than measurement would be the app claiming an authority it does not have,
and would be obviously templated by the third team.

Every sentence on this screen states a computed fact. Where a fact is unavailable — a
player without ADP, a team with no bye clash — the line is omitted rather than padded.

## Out of scope

- **Any predicted finish or win-loss record.** The schedule is not in the data. Already
  forbidden in chunk F and enforced by a test; it stays forbidden here.
- **Reordering the existing ranking.** The grading change alters the numbers, not the
  presentation of the table above.
- **Printing or exporting the report.** Nobody asked, and the page is already shareable by
  URL now that the app is hosted.

## Testing

Everything here is derived from `data/players.json` and draft state, so it is testable
without a DOM: each section gets a pure function in `src/core/` returning data, and the
rendering is a thin pass over it. The grading change needs a test pinning that a kicker no
longer moves a team's strength — the regression that motivated the whole chunk.
