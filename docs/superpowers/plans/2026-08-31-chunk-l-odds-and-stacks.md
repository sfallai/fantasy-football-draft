# Availability Odds and Stacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "will he still be there at my next pick?" from the ADP spread the fetch already carries, and mark when a player shares an NFL team with someone already on your roster.

**Architecture:** One new pure core module computes a conditional probability from `adp` and `adpStdev` and maps it to a band; a second reports shared-team pairings. Both are rendered as secondary lines on a recommendation card, following the established `byeWarning` / `backupNote` pattern. Nothing touches `src/core/recommend.js` — these are facts about a player, not reasons to draft him, and `reasonsFor` slices to two.

**Tech Stack:** Plain ES modules, no dependencies. `node --test` with `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-31-handcuffs-stacks-and-odds-design.md` — the "Chunk L" section, plus "The scale ADP is measured on".

## Global Constraints

- Node >= 22. **Zero npm dependencies, permanently.** The normal CDF is implemented inline.
- `draft.html` is a build artifact. **Never hand-edit it.** Only the final task runs `npm run build`. Note that creating any file under `src/` stales it immediately — the bundler inlines every file there, reachable or not — so `tests/build.test.js` fails from the first task until the rebuild. That single failure is expected; any other is not.
- Modules under `src/` may use **only** single-line `import { a } from './rel.js';` and `export function|const|class`.
- **Do not run `npm run fetch`** and do not touch anything under `data/`.
- **Do not touch `src/core/recommend.js`.**
- **Do not run `git stash`.** An earlier chunk lost work that way.
- `src/styles.css` ends **inside** its `@media print` block; check where the block closes before appending. Do not write the literal `@media print` at column 0 anywhere else — `tests/print-styles.test.js` locates the block with a line-anchored regex.
- **No percentage may appear on screen.** See "Bands, not percentages" below.
- Every sentence states a computed fact; where a fact is unavailable the line is omitted rather than padded.

## Vocabulary and measured facts

All verified against the shipped pool before this plan was written.

- **`adp`** is an **overall pick number**, roughly league-size independent — the Nth best player goes around pick N whatever the league size, because draft order follows player value. **Never rescale it by team count.** Requesting `teams=10` and `teams=12` returns byte-identical ADPs for all 221 players.
- **`adpStdev`** — min 0.6, median 9.6, max 29.3, and it rises monotonically with ADP (2.5 in picks 0–29 up to 14.4 in 150–179), which is what a real draft-position spread must do.
- **`adpEarliest` / `adpLatest`** — the extremes actually observed. `adpLatest` near the ceiling is the end of a 180-pick board, not an observation.
- **`adpDrafts`** — the sample size. 23 players rest on fewer than 15 drafts; the thinnest is 5.
- **The tails are fatter than a normal.** Observed range ÷ 4σ has a median of 1.11 and a p90 of 1.34, so a normal approximation is **overconfident in the tails** — which is exactly where a number looks most authoritative.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/odds.js` (new) | `normalCdf`, `availabilityOdds`, `BANDS`. Pure. |
| `src/core/stack.js` (new) | `stackPartner(player, roster)` — the owned teammate a player would pair with, or null. Pure. |
| `src/ui/center.js` (modify) | Two secondary lines on the recommendation card, beside `byeWarning` and `backupNote`. |
| `src/styles.css` (modify) | Two rules, matching `.bye-warn` weight. |
| `draft.html` (regenerated) | Final task only. |

---

## Task 1: The probability, and the two places it must refuse to answer

**Files:**
- Create: `src/core/odds.js`
- Test: create `tests/odds.test.js`

**Interfaces:**
- Produces:
  - `normalCdf(z)` → number in [0, 1]
  - `BANDS` — `[[floor, label], …]`, highest floor first
  - `bandFor(p)` → label string
  - `availabilityOdds(player, currentPick, nextPick)` → `{ probability, band }` or **`null`** when the model must not answer

**The model.** Given mean `μ = player.adp`, spread `σ = player.adpStdev`, the current pick `C` and your next pick `N`:

```
P(lasts to N | still available at C) = (1 − Φ((N − 0.5 − μ)/σ)) / (1 − Φ((C − 0.5 − μ)/σ))
```

**The conditioning is the whole point.** ADP is where a player goes *on average across drafts*; by the time you are looking at him he has already survived to pick `C`, and in the drafts where he went early he is not on your board at all. Without the denominator, a player sitting 40 picks past his ADP reads "almost certainly gone" while he is visibly still there. Measured: for a player with μ=128, σ=11 at pick 168 looking at pick 181, the unconditional figure is 0.0000 and the conditional is 0.0055.

**The two refusals.** Both return `null`, and both matter more than the arithmetic.

1. **No usable inputs.** `adp` or `adpStdev` null, `σ <= 0`, or no `nextPick`. This is not defensive padding: `null` in JavaScript arithmetic yields **`Infinity`, not `NaN`** — `(pick − adp)/null` is `Infinity`, `null < 3` is `true` — so an unguarded model produces a **confident** answer of 0 or 1 rather than failing loudly. Verified: passing `σ = null` to the formula above returns exactly `0`, which would render "almost certainly gone".

2. **The current pick is past `adpLatest`.** Then the player has already lasted longer than he has ever been observed lasting, and the model is extrapolating into the tail it is measurably worst in. Refuse rather than assert. This uses observed data as the boundary instead of an invented threshold, and it is live without being silencing — measured across the shipped pool it withholds 15 of 217 candidates at pick 24, 23 of 197 at pick 60, and 20 of 83 at pick 170.

- [ ] **Step 1: Write the failing test**

Create `tests/odds.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalCdf, availabilityOdds, bandFor, BANDS } from '../src/core/odds.js';

const pl = (over = {}) => ({
  id: 'p', name: 'Player', position: 'RB', projectedPoints: 200,
  adp: 128, adpStdev: 11, adpEarliest: 100, adpLatest: 148, adpDrafts: 2017, ...over,
});

test('normalCdf matches the standard normal at known points', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1) - 0.158655) < 1e-5);
  assert.ok(Math.abs(normalCdf(-1) - (1 - normalCdf(1))) < 1e-9, 'and is symmetric');
});

test('the band table is the spec\'s, label for label', () => {
  // Written out rather than derived: the cut points are a labelling choice, and a test
  // that recomputed them from the source could not catch one being moved.
  assert.deepEqual(BANDS, [
    [0.85, 'Almost certainly still there'],
    [0.60, 'Likely still there'],
    [0.40, 'Coin flip'],
    [0.15, 'Likely gone'],
  ]);
  assert.equal(bandFor(0.9), 'Almost certainly still there');
  assert.equal(bandFor(0.85), 'Almost certainly still there', 'the floor belongs to its band');
  assert.equal(0.849 > 0.6, true);
  assert.equal(bandFor(0.849), 'Likely still there');
  assert.equal(bandFor(0.5), 'Coin flip');
  assert.equal(bandFor(0.2), 'Likely gone');
  assert.equal(bandFor(0.14), 'Almost certainly gone');
  assert.equal(bandFor(0), 'Almost certainly gone');
});

test('a player miles from his ADP is likely still there at the next pick', () => {
  const odds = availabilityOdds(pl({ adp: 200, adpLatest: 260 }), 20, 32);
  assert.ok(odds.probability > 0.9, `expected near-certain, got ${odds.probability}`);
  assert.equal(odds.band, 'Almost certainly still there');
});

test('a player whose ADP sits inside the wait is unlikely to last', () => {
  const odds = availabilityOdds(pl(), 120, 141);
  assert.ok(odds.probability < 0.4, `expected unlikely, got ${odds.probability}`);
});

test('the odds are conditioned on his still being here', () => {
  // The reason the denominator exists. Unconditioned, a player well past his ADP reads
  // "almost certainly gone" while he is visibly on the board in front of you.
  const player = pl({ adp: 128, adpStdev: 11, adpLatest: 200 });
  const early = availabilityOdds(player, 100, 112).probability;
  const late = availabilityOdds(player, 160, 172).probability;
  assert.ok(late > 0, 'a survivor is not written off entirely');
  assert.ok(late > early * 0.0001, 'and the conditioning keeps him on the scale');
});

test('waiting zero picks is certainty, not arithmetic', () => {
  assert.equal(availabilityOdds(pl(), 120, 120).probability, 1);
});

test('the model refuses when the pick is past anything ever observed', () => {
  // He has already lasted longer than he has ever been seen lasting, so the model is
  // extrapolating into the tail it is measurably worst in. Saying nothing is honest;
  // saying "almost certainly gone" about a player sitting in front of you is not.
  assert.equal(availabilityOdds(pl({ adpLatest: 148 }), 149, 160), null);
  assert.ok(availabilityOdds(pl({ adpLatest: 148 }), 148, 160), 'but not at the boundary itself');
});

test('a missing spread produces no answer, not a confident one', () => {
  // null in arithmetic yields Infinity, not NaN: (pick - adp) / null is Infinity and
  // null < 3 is true, so an unguarded model returns a confident 0 or 1. Verified: the
  // raw formula with a null sigma returns exactly 0, which renders "almost certainly gone".
  assert.equal(availabilityOdds(pl({ adpStdev: null }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adp: null }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adpStdev: 0 }), 120, 141), null);
  assert.equal(availabilityOdds(pl({ adpStdev: -3 }), 120, 141), null);
});

test('no next pick means no question to answer', () => {
  assert.equal(availabilityOdds(pl(), 120, null), null);
  assert.equal(availabilityOdds(pl(), 120, undefined), null);
});

test('the probability is always a real number in [0, 1]', () => {
  for (const [c, n, adp, sd] of [[1, 2, 1, 0.6], [170, 180, 5, 1], [10, 200, 150, 29]]) {
    const odds = availabilityOdds(pl({ adp, adpStdev: sd, adpLatest: 300 }), c, n);
    if (!odds) continue;
    assert.ok(Number.isFinite(odds.probability), `not finite for ${c}/${n}/${adp}/${sd}`);
    assert.ok(odds.probability >= 0 && odds.probability <= 1, `out of range: ${odds.probability}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/odds.test.js`
Expected: FAIL — `Cannot find module '../src/core/odds.js'`.

- [ ] **Step 3: Implement**

Create `src/core/odds.js`:

```js
// Abramowitz & Stegun 7.1.26, accurate to about 1e-7 — far beyond what five bands can
// use. Inline because this app takes no dependency, ever.
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Bands, not a percentage, and this is a measurement rather than a preference: real ADP
// ranges run 11% wider than a normal at the median and 34% wider at the p90, so the model
// is overconfident exactly in the tails, where a number looks most authoritative. Printing
// "13%" invites the reader to tell it from "24%" when the model cannot.
//
// The cut points are arbitrary in the way GRADE_BANDS is arbitrary: they label a
// continuum, they are stated here rather than buried, and a test pins them.
export const BANDS = [
  [0.85, 'Almost certainly still there'],
  [0.60, 'Likely still there'],
  [0.40, 'Coin flip'],
  [0.15, 'Likely gone'],
];

export function bandFor(probability) {
  for (const [floor, label] of BANDS) if (probability >= floor) return label;
  return 'Almost certainly gone';
}

// Returns null wherever the model has nothing honest to say — see the two refusals.
export function availabilityOdds(player, currentPick, nextPick) {
  if (!player || !nextPick || !currentPick) return null;

  const mu = player.adp;
  const sigma = player.adpStdev;
  // Explicit null/finite checks, NOT a falsy guard and NOT bare arithmetic: null in
  // arithmetic yields Infinity rather than NaN, so an unguarded model answers 0 or 1
  // with total confidence instead of failing. A sigma of 0 is no information, not
  // certainty.
  if (typeof mu !== 'number' || !Number.isFinite(mu)) return null;
  if (typeof sigma !== 'number' || !Number.isFinite(sigma) || sigma <= 0) return null;

  // Past everything ever observed, the model is extrapolating into the tail it is
  // measurably worst in. Refuse. Uses the data's own support as the boundary rather
  // than an invented threshold.
  if (typeof player.adpLatest === 'number' && currentPick > player.adpLatest) return null;

  if (nextPick <= currentPick) return { probability: 1, band: bandFor(1) };

  // Continuity correction on both, so the pair reconciles rather than drifting apart.
  const survivesToNext = 1 - normalCdf((nextPick - 0.5 - mu) / sigma);
  const survivedToNow = 1 - normalCdf((currentPick - 0.5 - mu) / sigma);
  if (!Number.isFinite(survivedToNow) || survivedToNow < 1e-9) return null;

  const probability = Math.max(0, Math.min(1, survivesToNext / survivedToNow));
  return { probability, band: bandFor(probability) };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/odds.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: green except `tests/build.test.js`, which is now stale because a new file exists under `src/`. Do not run the build.

```bash
git add src/core/odds.js tests/odds.test.js
git commit -m "feat(odds): how likely a player is to last until your next pick"
```

---

## Task 2: Stacks

**Files:**
- Create: `src/core/stack.js`
- Test: create `tests/stack.test.js`

**Interfaces:**
- Produces: `stackPartner(player, roster)` → the owned player he would pair with, or `null`.

**A stack is a QB paired with a pass-catcher on the same NFL team**, in either direction: an available WR/TE when you own that team's QB, or an available QB when you own that team's WR/TE. **Two running backs on one team is a committee, not a stack** — they split the same carries rather than sharing a passing play.

**The marker states the shared team and nothing more.** Not "pairs well". Stacking is a correlation play whose value is well established in DFS and best-ball and much weaker in a season-long non-PPR league, where it mostly raises variance. The shared team is a fact; "pairs well" is a recommendation this data cannot support, and the app's standing rule is that every sentence states a computed fact.

- [ ] **Step 1: Write the failing test**

Create `tests/stack.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackPartner } from '../src/core/stack.js';

const pl = (id, position, team, name = id) => ({
  id, name, position, team, projectedPoints: 200, bye: 9,
});

test('an available receiver pairs with your quarterback on that team', () => {
  const roster = [pl('goff', 'QB', 'DET', 'Jared Goff')];
  assert.equal(stackPartner(pl('arsb', 'WR', 'DET'), roster).name, 'Jared Goff');
});

test('a tight end counts too', () => {
  const roster = [pl('goff', 'QB', 'DET', 'Jared Goff')];
  assert.equal(stackPartner(pl('laporta', 'TE', 'DET'), roster).id, 'goff');
});

test('and it works the other way round', () => {
  const roster = [pl('arsb', 'WR', 'DET', 'Amon-Ra St. Brown')];
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), roster).name, 'Amon-Ra St. Brown');
});

test('two running backs on one team are a committee, not a stack', () => {
  // They split the same carries rather than sharing a passing play.
  const roster = [pl('gibbs', 'RB', 'DET')];
  assert.equal(stackPartner(pl('montgomery', 'RB', 'DET'), roster), null);
});

test('a receiver does not stack with another receiver', () => {
  const roster = [pl('arsb', 'WR', 'DET')];
  assert.equal(stackPartner(pl('jamo', 'WR', 'DET'), roster), null);
});

test('a different team is not a stack', () => {
  const roster = [pl('goff', 'QB', 'DET')];
  assert.equal(stackPartner(pl('nacua', 'WR', 'LAR'), roster), null);
});

test('a kicker or defense never stacks', () => {
  const roster = [pl('goff', 'QB', 'DET')];
  assert.equal(stackPartner(pl('k', 'K', 'DET'), roster), null);
  assert.equal(stackPartner(pl('def', 'DEF', 'DET'), roster), null);
});

test('an unknown team never matches, even against itself', () => {
  // Free agents carry 'FA'. Two of them are not team-mates.
  const roster = [pl('a', 'QB', 'FA')];
  assert.equal(stackPartner(pl('b', 'WR', 'FA'), roster), null);
});

test('an empty roster pairs with nobody, and does not throw', () => {
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), []), null);
});

test('the best partner is returned when there are several', () => {
  const roster = [
    { ...pl('wr2', 'WR', 'DET'), projectedPoints: 120 },
    { ...pl('wr1', 'WR', 'DET'), projectedPoints: 210 },
  ];
  assert.equal(stackPartner(pl('goff', 'QB', 'DET'), roster).id, 'wr1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/stack.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/core/stack.js`:

```js
// A stack is a quarterback and a pass-catcher on the same NFL team: one throw scores for
// both. Two running backs on one team are a committee — they split the same carries
// rather than sharing a play — and two receivers compete for the same targets.
const CATCHERS = ['WR', 'TE'];

// Free agents all carry 'FA', so a team code alone is not proof of a shared team.
const UNKNOWN_TEAM = 'FA';

function pairsWith(position) {
  if (position === 'QB') return CATCHERS;
  if (CATCHERS.includes(position)) return ['QB'];
  return [];
}

// The owned player this one would pair with, or null. States the pairing and nothing
// more: whether a stack is *good* in a season-long non-PPR league is a judgement this
// data cannot support, and the app does not make judgements it cannot compute.
export function stackPartner(player, roster) {
  if (!player || !player.team || player.team === UNKNOWN_TEAM) return null;
  const wanted = pairsWith(player.position);
  if (wanted.length === 0) return null;

  return (roster || [])
    .filter((owned) => owned
      && owned.team === player.team
      && owned.id !== player.id
      && wanted.includes(owned.position))
    .sort((a, b) => b.projectedPoints - a.projectedPoints)[0] || null;
}
```

- [ ] **Step 4: Run the tests, then the suite, then commit**

Run: `node --test tests/stack.test.js` → PASS.
Run: `npm test` → green except `tests/build.test.js`.

```bash
git add src/core/stack.js tests/stack.test.js
git commit -m "feat(stack): the owned team-mate a player would pair with"
```

---

## Task 3: The two lines on the card, and the rebuild

**Files:**
- Modify: `src/ui/center.js`, `src/styles.css`
- Test: `tests/render-center.test.js`
- Regenerate: `draft.html`

**Interfaces:**
- Consumes: `availabilityOdds(player, currentPick, nextPick)` and `stackPartner(player, roster)`.

**`renderCenter`'s ctx already carries `currentPick`, `nextPick` and `myRoster`** — verified,
no new ctx field is needed. But `recommendationCard(rec, myRoster, slots, pool)` does **not**
take the two pick numbers, so they have to be threaded through it. `myRoster` is already
there for `byeWarning`, and `pool` for `backupNote`; add `currentPick` and `nextPick`
alongside them and pass them at the single call site. Check the current signature before
editing rather than trusting this line — it is the kind of detail that drifts.

**These are lines on the card, not reasons.** `byeWarning` and `backupNote` are the working precedent. **Do not touch `src/core/recommend.js`.**

**Read `tests/render-center.test.js` before writing any fixture.** Its helpers and row classes are what they are, not what this plan guesses. Seven defective fixtures were found in the previous chunk, most from assuming a file's conventions; several passed vacuously.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render-center.test.js`, matching its existing helpers:

```js
test('a recommendation says how likely the player is to last', () => {
  // The band, and the inputs under it, so the claim is auditable and obviously a model.
  // Build a ctx whose top recommendation carries an adp and a spread.
});

test('no odds line when the model refuses to answer', () => {
  // A player with no adpStdev. Omit rather than say "unknown".
});

test('no percentage appears anywhere on the screen', () => {
  // The measured reason for bands: real tails run 11-34% wider than a normal, so a
  // number looks most authoritative exactly where the model is worst.
  const text = allText(container);
  assert.doesNotMatch(text, /\d+\s?%/);
});

test('a stack is stated as a shared team, never as advice', () => {
  assert.match(text, /same NFL team/i);
  assert.doesNotMatch(text, /pairs well|good fit|recommended/i);
});
```

Fill each in against the file's real fixtures. **Every one must be able to fail** — check by mutation, not by inspection.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement the lines**

In `src/ui/center.js`, beside `byeWarning` and `backupNote`:

```js
// A model, and it says so: the band is the reading, the numbers under it are what
// produced it. `availabilityOdds` returns null wherever it has nothing honest to say —
// no spread, no next pick, or a player already past anything ever observed — and a null
// renders nothing at all rather than "unknown".
function oddsNote(player, currentPick, nextPick) {
  const odds = availabilityOdds(player, currentPick, nextPick);
  if (!odds) return null;
  const drafts = player.adpDrafts ? ` across ${player.adpDrafts} drafts` : '';
  return el('div', { class: 'odds-note' }, [
    el('span', { class: 'odds-band', text: odds.band }, []),
    el('span', {
      text: ` — ADP ${Math.round(player.adp)} ± ${Math.round(player.adpStdev)}${drafts}; you pick again at ${nextPick}`,
    }, []),
  ]);
}

// The shared team, and nothing more. Whether a stack is GOOD in a season-long non-PPR
// league is a judgement this data cannot support.
function stackNote(player, myRoster) {
  const partner = stackPartner(player, myRoster || []);
  return partner
    ? el('div', { class: 'stack-note', text: `Same NFL team as your ${partner.position}, ${partner.name}` }, [])
    : null;
}
```

Call both from `recommendationCard` alongside the existing two, appending each result when not null.

Append to `src/styles.css` — **after** the `@media print` block closes:

```css
/* Same weight as the bye warning: secondary facts under the reasons, not reasons. */
.rec .odds-note { color: var(--muted); font-size: 11.5px; margin-top: 3px; }
.rec .odds-band { font-weight: 600; }
.rec .stack-note { color: var(--muted); font-size: 11.5px; margin-top: 3px; }
```

- [ ] **Step 4: Rebuild**

Run: `npm run build`. This is the only task that runs it, and its commit is the only one that may contain `draft.html`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: **fully green**, `tests/build.test.js` included.

- [ ] **Step 6: Commit**

```bash
git add src/ui/center.js src/styles.css tests/render-center.test.js draft.html
git commit -m "feat(center): say whether a player will last, and who he stacks with"
```

- [ ] **Step 7: State the browser check**

`tests/dom-stub.js` has no layout engine. A recommendation card can now carry **four**
secondary lines — bye warning, handcuff, odds, stack. Report that a human must confirm:

- the third recommendation is still reachable in `.center-scroll` with a card carrying
  several lines, and the scroll hint still appears and clears. The panel has shipped
  exactly this bug before and no test here could see it.
- the odds line wraps sanely at the panel's narrow end rather than pushing the card wide.
- the band reads as a claim and the numbers under it as its evidence, not as two
  unrelated sentences.

---

## Self-review

**Spec coverage.**

| Spec requirement (Chunk L) | Task |
|---|---|
| Conditional probability, with the denominator | 1 |
| Continuity correction | 1 |
| `normalCdf` inline, no dependency | 1 |
| Bands, never a percentage | 1 (table pinned), 3 (asserted on screen) |
| Band table stated and pinned | 1 |
| Omit rather than pad when a fact is unavailable | 1 (two refusals), 3 |
| The inputs shown under the band | 3 |
| Sample size named | 3 (`adpDrafts`) |
| Stack in both directions, QB↔WR/TE only | 2 |
| Not two RBs | 2 |
| States the shared team, never "pairs well" | 2 (comment), 3 (asserted) |
| No predicted finish, no win-loss record | Nothing here produces one |

**Placeholder scan.** Task 3's tests are deliberately sketched rather than written out, with an instruction to fill them against the real fixtures. That is a considered choice, not a gap: the previous chunk's fully-written example fixtures were wrong seven times, twice in ways that passed vacuously, because they guessed at a file's conventions. Sketching the assertion and naming what it must catch has produced better tests here than pretending to know the helpers.

**Type consistency.** `availabilityOdds` returns `{probability, band}` or `null`; every consumer checks for null first. `stackPartner` returns a player object or `null`. `BANDS` is `[number, string][]` and `bandFor` falls through to the fifth label rather than storing it in the table — the table holds floors, and "Almost certainly gone" has none.

**Risks worth naming.**

1. **The refusal past `adpLatest` is the one judgement call here.** It withholds between 7% and 24% of candidates depending on the pick. If it proves too aggressive in use, the fix is to widen the boundary, not to delete it — asserting into a tail the data has already contradicted is the failure it exists to prevent.
2. **A card can now carry four secondary lines.** That is a layout risk no test in this repo can see, and it is the specific bug this panel has shipped before.
3. **`adpDrafts` is named but not gated on.** 23 players rest on fewer than 15 drafts. Showing the count lets the reader discount it; a hard cut-off would need a threshold nobody can defend. If the thin-sample bands prove misleading in use, that is the first thing to revisit.
