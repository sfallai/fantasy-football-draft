# Handcuffs, Stacks and Availability Odds — Design Spec

## Overview

Three asks, in the order they unblock each other:

1. **Keep the ADP dispersion the fetch currently throws away.** Small, and it is what makes
   ask 3 possible at all.
2. **Handcuffs** — a filter for the backups to your own starters, and a flag on
   recommendation cards.
3. **Availability odds and stacking** — "will he last until my next pick?", and a neutral
   marker when a player shares an NFL team with someone you already own.

Each is a chunk. Each ships working software on its own.

## Measurements taken before writing this

Every number below was measured against the live sources, not assumed.

**FFC already returns dispersion, and `fetch-players.mjs:122` discards it.** The API gives
`adp`, `stdev`, `high`, `low` and `times_drafted`; the merge keeps only `adp`.

```
221 players, all with stdev > 0, sampled across 2,017 drafts
stdev   min 0.8   median 10.7   max 58.9
late-round players (adp > 100): 116, median stdev 15.9

Saquon Barkley  adp 1.6    sd 0.8   observed 1–3
Jordan Love     adp 127.5  sd 11.1  observed 100–148
```

**The tails are fatter than a normal distribution.** Comparing each player's observed
range to four standard deviations:

```
observed range / (4 × sd):   median 1.11   p90 1.34
```

A normal would put ~95% of draws inside ±2sd. The real ranges run 11% wider at the median
and 34% wider at the 90th percentile, so **a normal approximation is overconfident in the
tails** — it will say "almost certainly gone" more often than it should. This is the single
most important finding here and it decides the presentation: see "Bands, not percentages".

**ESPN publishes real ranked depth charts, and the ids join directly to `players.json`.**
Verified end to end against Detroit:

```
RB  1:Jahmyr Gibbs  2:Isiah Pacheco  3:(outside the 400-player pool)
WR  1:Amon-Ra St. Brown  2:Jameson Williams  3:Isaac TeSlaa
QB  1:Jared Goff
```

So the depth ordering is a fact — "the rank-2 player at this position on this NFL team" —
not the inference this design would otherwise have had to make. The naive inference ("same
team, same position, lower projection") would call Montgomery the handcuff to Gibbs when
they are co-starters, which is wrong in exactly the backfields people care about.

**Corrected after the chunk K review: the rank-2 player is a handcuff only at RB.** The
original wording above generalised a running-back idea to every position, and shipping it
put a false line on the four most-viewed cards in the app. See "What a handcuff is" below.

**The depth-chart response shape is stable, but its group names are not.** Sampled four
teams:

```
team  1 | Base 3-4 D / Special Teams / 3WR 1TE
team 12 | Base 4-3 D / Special Teams / 3WR 1TE
team 22 | Base 4-3 D / Special Teams / 3WR 1TE
team 33 | Base 3-4 D / Special Teams / 3WR 1TE
```

The defensive group's name varies with scheme. **Find the offensive group by looking for a
group whose `positions` contain both `qb` and `rb`** — never by name.

---

## Chunk J: Keep the ADP dispersion

**Goal:** `players.json` carries what the fetch already downloads and drops.

New fields per player, all nullable:

| Field | Source | Meaning |
|---|---|---|
| `adpStdev` | FFC `stdev` | Standard deviation of the pick he went at |
| `adpEarliest` | `min(high, low)` | Earliest pick observed |
| `adpLatest` | `max(high, low)` | Latest pick observed |
| `adpDrafts` | FFC `times_drafted` | How many drafts the figure rests on |

`adp` is unchanged. A player with no FFC match gets `null` for all five, exactly as today.

**FFC's `high`/`low` mean the opposite of what a pick number suggests, but they are
consistent.** Measured across all 221 players: `high < low` in 221 of 221 cases, and `adp`
falls inside the pair in 221 of 221. So `high` is *drafted high* — the earliest pick, the
smallest number — and `low` is the latest. That is a normal draft-room convention and it is
not a bug in the feed.

It is still a trap for every future reader of this code, who will see `adpHigh: 100,
adpLow: 148` and assume a transcription error. Store them as **`adpEarliest`** and
**`adpLatest`**, derived with `Math.min`/`Math.max` so the naming carries the meaning and
nothing downstream has to know the convention. The `Math.min`/`Math.max` is belt-and-braces
against a feed change, not a correction of one — a test asserts `adpEarliest <= adpLatest`
so a genuine flip would be caught rather than silently swallowed.

`adpDrafts` is carried because a spread computed from 12 drafts and one from 2,000 are not
the same claim, and chunk L's copy names the sample size.

**Not in this chunk:** anything that reads the new fields.

---

## Chunk K: Handcuffs

### The data

A new fetch step: 32 requests to
`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{SEASON}/teams/{id}/depthcharts`,
alongside the ~400 the fetch already makes.

For each team, find the group whose `positions` object has both `qb` and `rb`. Within each
of `qb`, `rb`, `wr`, `te`, sort `athletes` by `rank` and record the ordering by athlete id
(parsed from the `$ref` URL, which is the same id `players.json` uses).

Each player gains:

| Field | Meaning |
|---|---|
| `depthRank` | His rank at his position on his NFL team, or `null` |
| `backupId` | The id of the player ranked immediately below him, or `null` |

`backupId` may point at a player outside the 400-player pool. That is not an error; it means
the handcuff is not draftable from this app, and the UI omits rather than invents.

**A team whose depth chart fails to fetch leaves every one of its players at `null`.** The
fetch must not fail the whole run for one team, and must report how many teams resolved —
silently shipping 31 of 32 is the failure mode to avoid.

### What a handcuff is

**A handcuff is a running back, and only a running back.** A handcuff is the backup who
*inherits the workload* when the starter goes down: one back takes the carries, so his
value is contingent on the starter's health in a way nobody else's is. Wide-receiver
targets are redistributed among several players and the WR2 on a depth chart is a starter
in his own right; tight ends behave the same way.

Measured on the shipped 400-player pool, in-pool pairs whose *backup* is himself top-100
overall:

```
RB  64 pairs |  4      WR  87 pairs | 17      TE  23 pairs | 0      QB  14 pairs | 0
```

Seventeen WR pairs name a top-100 starter as somebody's "handcuff", and the four
most-viewed cards in the app each carried one: Chase → Tee Higgins (#45), Nacua → Davante
Adams (#31), St. Brown → Jameson Williams (#48), Lamb → George Pickens (#28).

**QB is excluded deliberately** even though a backup quarterback does inherit the job: in a
one-QB league nobody drafts one, so the line would be noise on every QB card for no
decision it could change.

This is enforced in one place, `HANDCUFF_POSITIONS` in `src/core/handcuff.js`, which both
the filter and the recommendation line read. Suppressing the line when the *backup* happens
to be startable is not an acceptable substitute: it is a threshold in disguise, it would
still show Chase → Higgins in a league where Higgins is not startable, and it leaves the
filter claiming a WR2 is a handcuff.

### Handcuff of *mine*

A player `H` is a handcuff of yours when some player `S` on your roster has
`S.backupId === H.id` **and `S` is a running back**. Restricted to your own roster
deliberately: that is the question being asked mid-draft ("I own Gibbs — is Pacheco still
there?"), and the whole-board variant is a much longer list serving a rarer strategy.

**Only startable starters count.** If `S` is himself a bench body, his backup is not a
handcuff in any useful sense. `S` must be occupying a non-bench slot in `assignSlots`, which
the app already computes and which the grade and the report card already share.

### The filter

A `Handcuffs` toggle in `.filters`, beside the position buttons. It is **ANDed** with the
position selection: with `RB` selected and `Handcuffs` on, you see your RB handcuffs only.

When it is on and there is nothing to show, the table shows a sentence saying why — "no
handcuffs on the board for your starters" or "you have no startable starters yet" — not an
empty table. An empty table reads as a bug.

### The recommendation flag

A recommendation card for a **running back** `P` gains a line when `P.backupId` resolves to
an available player: **"Handcuff available: <name>."** A fact, and the useful direction — it
tells you the insurance exists before you spend the pick. Gated on `HANDCUFF_POSITIONS`, the
same list the filter reads, so the two can never disagree about what a handcuff is.

---

## Chunk L: Availability odds, and stacks

### The model

Given a player with `adp` (μ) and `adpStdev` (σ), the current pick `C`, and your next pick
`N`, the probability he is still there at `N`, **conditioned on his still being here now**:

```
P(lasts to N | available at C)  =  (1 − Φ((N − 0.5 − μ) / σ)) / (1 − Φ((C − 0.5 − μ) / σ))
```

The conditioning is not decoration. ADP is where a player goes *on average across drafts*;
by the time you are looking at him he has already survived to pick `C`, and in the drafts
where he went early he is not on your board at all. Without the denominator, a player sitting
40 picks past his ADP reads as "almost certainly gone" while he is visibly still there.

Clamp the denominator away from zero and clamp the result to `[0, 1]`; a player far past his
ADP drives it toward a 0/0 that means "the model has nothing left to say".

Φ is the standard normal CDF, implemented inline — no dependency, ever. An Abramowitz–Stegun
7.1.26 approximation is accurate to ~1e-7, which is far beyond what the bands below can use.

### Bands, not percentages

**This is a design constraint, not a presentation preference, and the measurement above is
why.** Real ADP tails are 11–34% wider than a normal, so the model is overconfident exactly
where a percentage looks most authoritative. Printing "13%" invites a user to distinguish it
from "24%" when the model cannot. The app has never printed a modelled number and this is
not the place to start.

| Band | Conditional probability |
|---|---|
| Almost certainly still there | ≥ 0.85 |
| Likely still there | 0.60 – 0.85 |
| Coin flip | 0.40 – 0.60 |
| Likely gone | 0.15 – 0.40 |
| Almost certainly gone | < 0.15 |

These cut points are arbitrary in the same way `GRADE_BANDS` is arbitrary: they label a
continuum, they are stated here rather than buried, and a test pins the table letter for
letter so it cannot drift silently.

### What it says

Under the band, the inputs that produced it, so the claim is auditable and obviously a model:

```
Jordan Love  QB  GB

  Likely gone before your next pick
  ADP 128 ± 11 across 2,017 drafts; you pick again at 141,
  and 4 of the 12 picks before then need a QB
```

The last clause comes from `needCountsBetween` in `src/core/competitive.js`, which already
computes exactly this and is already wired into the draft screen.

**Omit rather than pad.** No `adpStdev`, no band — the line simply does not appear. No next
pick (you are on the clock in the final round) — no line. `adpDrafts` below a floor stated in
the plan — no line, because a spread from a handful of drafts is not a spread.

### Stacks

A player shares an NFL team with someone already on your roster. The marker states that and
nothing more:

> Same NFL team as your QB, Jared Goff.

**It must not say "pairs well".** Stacking is a correlation play whose value is well
established in DFS and best-ball and much weaker in a season-long non-PPR league, where it
mostly raises variance. The shared team is a fact; "pairs well" is a recommendation the data
here cannot support, and the app's standing rule is that every sentence states a computed
fact. The user can draw the conclusion; the app should not draw it for them.

Shown for a QB you own paired with an available WR/TE, and for a WR/TE you own paired with an
available QB. Not for two RBs on one team, which is a committee, not a stack.

## Out of scope

- **Any percentage, anywhere on the screen.** See "Bands, not percentages".
- **Whole-board handcuffs** and the handcuff-as-hostage strategy.
- **Reordering recommendations by availability.** The odds are a flag on a card, not a term
  in `scorePlayer`. Folding an ADP-derived probability into a score that already weights BPA
  and VBD would double-count ADP and is a much larger change to a tuned function.
- **Depth charts for K and DEF.** They live in the Special Teams group, they have no
  meaningful handcuff, and the grade already ignores both.

## Testing

Everything here is pure and testable without a DOM.

- The fetch's merge is already tested through `mergePlayers`; the depth-chart join gets the
  same treatment with a fixture, including a team whose chart is missing.
- Φ is pinned against known values (Φ(0) = 0.5, Φ(1.96) ≈ 0.975).
- The conditional is pinned on the case that motivates it: a player 40 picks past his ADP who
  is still on the board must not read "almost certainly gone".
- The band table is asserted literally, like `GRADE_BANDS`.
- A `players-data` test asserts the new fields exist and are nullable, and that
  `adpEarliest <= adpLatest` for every player that has both — which is what would catch the
  feed flipping the pair.

**The recurring blind spot applies unchanged:** `tests/dom-stub.js` has no layout engine.
The filter button, the empty state and the extra lines on recommendation cards are all
invisible to the suite, and the recommendations panel has already shipped a layout bug once
that no test could see. Each chunk ends with an explicit browser check.
