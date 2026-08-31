# ADP Dispersion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the four ADP dispersion fields the fetch already downloads from Fantasy Football Calculator and currently throws away, so a later chunk can answer "will he still be there at my next pick?"

**Architecture:** One change to `mergePlayers` in `scripts/fetch-players.mjs` — the FFC lookup maps currently store a bare `adp` number and must store the whole record instead — then a data refresh so the committed `data/players.json` actually carries the fields, and a rebuild so `draft.html` matches.

**Tech Stack:** Plain ES modules, no dependencies. `node --test` with `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-31-handcuffs-stacks-and-odds-design.md` — the "Chunk J" section, plus "Measurements taken before writing this".

## Global Constraints

- Node >= 22. **Zero npm dependencies, permanently.**
- `draft.html` is a build artifact. **Never hand-edit it.** `tests/build.test.js` rebuilds in-process and asserts byte equality, and separately asserts the artifact matches `data/players.json`.
- Modules under `src/` may use **only** single-line `import { a } from './rel.js';` and `export function|const|class`. `scripts/` is not bundled and is not subject to this, but keep the house style.
- **Nothing in `src/` changes in this chunk.** No feature reads the new fields yet.
- Every new field is nullable. A player with no FFC match keeps `null`, exactly as `adp` does today.

## Vocabulary

- **FFC** — fantasyfootballcalculator.com, the ADP source at `scripts/fetch-players.mjs:12`.
- **`high` / `low`** — FFC's names for the extremes, and they mean the opposite of what a pick number suggests: `high` is *drafted high*, the **earliest** pick and therefore the **smallest** number. Measured across all 221 players in the live feed, `high < low` in 221 of 221 cases and `adp` falls inside the pair in 221 of 221. The feed is consistent; the names are the trap.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/fetch-players.mjs` (modify) | The FFC lookup maps carry the whole record; `mergePlayers` emits four new fields. |
| `tests/players-data.test.js` (modify) | Fixture tests for the merge, then the shipped-data schema test tightened once real data carries the fields. |
| `data/players.json` (regenerated) | Written by `npm run fetch`. Never hand-edited. |
| `data/fetched-at.json` (regenerated) | Same. |
| `draft.html` (regenerated) | Written by `npm run build`. Never hand-edited. |

---

## Task 1: Carry the dispersion through the merge

**Files:**
- Modify: `scripts/fetch-players.mjs:117-122` (the FFC lookup maps) and `mergePlayers`'s two object literals
- Test: `tests/players-data.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: every player object returned by `mergePlayers` gains `adpStdev`, `adpEarliest`, `adpLatest`, `adpDrafts` — each a `number` or `null`.

**The one subtlety.** Lines 121-122 currently store a bare number:

```js
if (position === 'DEF') adpByDefTeam.set(p.team, p.adp);
else adpByName.set(normalizeName(p.name), p.adp);
```

Both maps must store the whole FFC record so the other fields survive the lookup. Every read of those maps then changes shape too — `mergePlayers` has one, at line 144, currently `?? null` on a number. A partial change here is the likely bug: the maps updated but the read left alone gives every player `[object Object]` for an ADP, which no existing test catches because the fixture tests assert `adp === 1.4` on a value that would become an object and fail loudly — good — but the *shipped-data* schema test asserts only `typeof p.adp === 'number'`, and would fail too. Both nets exist; do not rely on either.

- [ ] **Step 1: Write the failing tests**

Add to `tests/players-data.test.js`, after the existing `mergePlayers leaves adp null when FFC has no entry` test:

```js
test('mergePlayers keeps the ADP spread, not just the mean', () => {
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  // FFC's own field names: `high` is the EARLIEST pick and the smaller number.
  const ffc = { players: [
    { name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5, stdev: 11.1, high: 100, low: 148, times_drafted: 2017 },
  ] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adp, 127.5);
  assert.equal(love.adpStdev, 11.1);
  assert.equal(love.adpEarliest, 100, 'FFC calls this `high` — drafted high, i.e. early');
  assert.equal(love.adpLatest, 148);
  assert.equal(love.adpDrafts, 2017);
});

test('the extremes are ordered by what they mean, not by what FFC calls them', () => {
  // Belt and braces against a feed change. FFC is consistent today — high < low in
  // 221 of 221 live players — so this is guarding a future flip, not fixing one.
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  const ffc = { players: [
    { name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5, stdev: 11.1, high: 148, low: 100, times_drafted: 9 },
  ] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adpEarliest, 100);
  assert.equal(love.adpLatest, 148);
});

test('a defense carries the spread too, joined on team abbrev', () => {
  const espn = { players: [{ player: {
    id: 222, fullName: 'Seahawks D/ST', defaultPositionId: 16, proTeamId: 26,
    draftRanksByRankType: { STANDARD: { rank: 120 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 104 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 26, abbrev: 'SEA', byeWeek: 11 }] } };
  const ffc = { players: [
    { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 133.2, stdev: 14.2, high: 110, low: 160, times_drafted: 812 },
  ] };

  const [def] = mergePlayers(espn, teams, ffc);
  assert.equal(def.adp, 133.2, 'the ADP itself still resolves — the map now holds a record, not a number');
  assert.equal(def.adpStdev, 14.2);
  assert.equal(def.adpDrafts, 812);
});

test('a player FFC has never seen gets null for every ADP field', () => {
  const espn = { players: [{ player: {
    id: 333, fullName: 'Deep Sleeper', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 250 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 40 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const [p] = mergePlayers(espn, teams, { players: [] });
  assert.deepEqual(
    [p.adp, p.adpStdev, p.adpEarliest, p.adpLatest, p.adpDrafts],
    [null, null, null, null, null],
  );
});

test('an FFC record missing a spread yields null for it, not NaN or undefined', () => {
  // Defenses and deep players have been seen with adp but no stdev.
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  const ffc = { players: [{ name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5 }] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adp, 127.5);
  assert.equal(love.adpStdev, null);
  assert.equal(love.adpEarliest, null);
  assert.equal(love.adpLatest, null);
  assert.equal(love.adpDrafts, null);
});
```

Also update the existing `mergePlayers joins ESPN projections with FFC adp and team byes` test, whose `assert.deepEqual` on the whole Gibbs object will now be missing four keys. Add them to the expected object as `null` (that fixture's FFC entry has no `stdev`):

```js
  assert.deepEqual(gibbs, {
    id: '111', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
    overallRank: 1, positionRank: 1, projectedPoints: 297.1, adp: 1.4, bye: 6,
    adpStdev: null, adpEarliest: null, adpLatest: null, adpDrafts: null,
    age: null, experience: null, prior: null,
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/players-data.test.js`
Expected: FAIL — `adpStdev` is `undefined`, and the updated `deepEqual` reports four missing keys.

- [ ] **Step 3: Make the FFC maps carry the whole record**

In `scripts/fetch-players.mjs`, replace lines 116-122:

```js
  // FFC lookups: skill players by normalized name, defenses by team abbrev. The whole
  // record, not just `p.adp` — the spread beside it is what makes "will he last until my
  // next pick?" answerable at all, and it was being downloaded and dropped.
  const adpByName = new Map();
  const adpByDefTeam = new Map();
  for (const p of ffcJson.players || []) {
    const position = p.position === 'PK' ? 'K' : p.position;
    if (position === 'DEF') adpByDefTeam.set(p.team, p);
    else adpByName.set(normalizeName(p.name), p);
  }
```

- [ ] **Step 4: Emit the four fields**

Still in `mergePlayers`, replace the single `adp:` line in the first object literal (currently line 144) with a lookup of the record and five fields derived from it:

```js
    const ffc = (isDef ? adpByDefTeam.get(abbrev) : adpByName.get(normalizeName(p.fullName))) ?? null;
```

Put that beside the existing `const { age, experience } = ...` line, then in the object literal:

```js
      adp: num(ffc && ffc.adp),
      adpStdev: num(ffc && ffc.stdev),
      // FFC's `high` is drafted-high — the EARLIEST pick and the smaller number. Stored
      // under names that say which is which, so nothing downstream has to know the
      // convention. min/max rather than a straight rename: the feed is consistent today
      // (high < low in 221 of 221 live players), and this keeps a future flip from
      // silently inverting the pair.
      adpEarliest: num(ffc && Math.min(ffc.high, ffc.low)),
      adpLatest: num(ffc && Math.max(ffc.high, ffc.low)),
      adpDrafts: num(ffc && ffc.times_drafted),
```

Add this helper beside `athleteFields` (`scripts/fetch-players.mjs:76`, above `mergePlayers`):

```js
// Anything the feed does not carry becomes null, never NaN or undefined. Math.min of an
// undefined is NaN, and a NaN in the data would serialize to `null` in JSON but pass a
// `typeof === 'number'` check in memory — two different shapes for one absence.
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
```

Then add the same five keys to the **second** object literal — the one inside the final
`merged.map(...)` that builds the shipped shape, whose `adp: p.adp,` is at
`scripts/fetch-players.mjs:165`. Place them directly after it:

```js
      adp: p.adp,
      adpStdev: p.adpStdev,
      adpEarliest: p.adpEarliest,
      adpLatest: p.adpLatest,
      adpDrafts: p.adpDrafts,
```

Forgetting this second literal is the most likely mistake in the task: the fields would exist
on the intermediate objects, every fixture test that inspects them would still fail, and it
would look like the first edit had not applied.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/players-data.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all green. Nothing in `src/` changed and `data/players.json` has not been
regenerated yet, so the shipped-data schema test still passes against the old shape — it
asserts the fields it knows about and does not yet know about these.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-players.mjs tests/players-data.test.js
git commit -m "feat(fetch): keep the ADP spread, not just the mean"
```

---

## Task 2: Refresh the data so the fields actually ship

**Files:**
- Modify: `tests/players-data.test.js` (the shipped-data schema test at line 201)
- Regenerate: `data/players.json`, `data/fetched-at.json`, `draft.html`

**Interfaces:**
- Consumes: `mergePlayers`'s new output shape from Task 1.
- Produces: a committed `data/players.json` whose players carry the four fields.

**This task makes a network call, and that is the point.** Task 1 changed the code that
*would* write the fields; until a fetch runs, the committed data does not have them and no
later chunk can read them. `npm run fetch` is the supported way to do this — it is what the
daily GitHub Actions cron runs — and the workflow's order is fetch → build → test, which is
the order below.

**If the fetch fails, stop and report.** A network error, an upstream schema change, or FFC
being down are all real. Do not hand-write the fields into `data/players.json`, do not
partially edit it, and do not commit a half-refreshed file. `git checkout data/players.json
data/fetched-at.json` restores the committed state.

- [ ] **Step 1: Record what the current data looks like**

Run:

```bash
node -e "const p=require('./data/players.json');console.log('players',p.length,'with adp',p.filter(x=>x.adp!==null).length,'with adpStdev',p.filter(x=>x.adpStdev!==undefined&&x.adpStdev!==null).length)"
```

Expected: a player count, a non-zero ADP count, and **0** with `adpStdev`. Write both numbers
into your report — they are the before half of the comparison in Step 3.

- [ ] **Step 2: Fetch**

Run: `npm run fetch`

Expected: it prints its progress and a summary line naming the FFC sample size. It refreshes
projections as well as ADP, so `data/players.json` will show many unrelated diffs. That is
normal — it is exactly what the daily cron commits.

- [ ] **Step 3: Verify the fields landed, with coverage**

Run:

```bash
node -e "
const P=require('./data/players.json');
const has=(f)=>P.filter(x=>x[f]!==null&&x[f]!==undefined).length;
console.log('players',P.length);
for (const f of ['adp','adpStdev','adpEarliest','adpLatest','adpDrafts']) console.log(' ',f,has(f));
const bad=P.filter(x=>x.adpEarliest!==null&&x.adpLatest!==null&&x.adpEarliest>x.adpLatest);
console.log('earliest > latest:',bad.length);
const sd=P.filter(x=>x.adpStdev!==null).map(x=>x.adpStdev).sort((a,b)=>a-b);
console.log('stdev median', sd.length?sd[Math.floor(sd.length/2)]:'n/a');
"
```

Expected: `adpStdev` coverage close to `adp` coverage (the live feed had a `stdev` for all
221 players it carries), `earliest > latest: 0`, and a stdev median in the region of 10 —
the measurement in the spec was 10.7. A median of 0, or a coverage of 0, means the join
silently failed; stop and report rather than committing it.

- [ ] **Step 4: Tighten the schema test**

In `tests/players-data.test.js`, inside the `generated data/players.json matches the schema`
test's `for (const p of players)` loop, after the existing `adp` assertion:

```js
    assert.ok(p.adp === null || typeof p.adp === 'number');
    for (const field of ['adpStdev', 'adpEarliest', 'adpLatest', 'adpDrafts']) {
      assert.ok(p[field] === null || typeof p[field] === 'number', `${p.name} ${field}`);
    }
    assert.ok(
      p.adpEarliest === null || p.adpLatest === null || p.adpEarliest <= p.adpLatest,
      `${p.name} adpEarliest ${p.adpEarliest} is later than adpLatest ${p.adpLatest}`,
    );
```

And after the loop, beside the existing "a refresh that returned zeros" guard, add a coverage
guard in the same spirit:

```js
  // A join that silently stopped matching would leave every spread null while every
  // other check above still passed — and the availability odds would then simply never
  // appear, with nothing to say why.
  const withAdp = players.filter((p) => p.adp !== null).length;
  const withSpread = players.filter((p) => p.adpStdev !== null).length;
  assert.ok(
    withSpread >= withAdp * 0.9,
    `only ${withSpread} of ${withAdp} players with an ADP also have a spread — the FFC join has broken`,
  );
```

- [ ] **Step 5: Rebuild and run the whole suite**

Run: `npm run build && npm test`
Expected: fully green, including `tests/build.test.js`, which checks both that `draft.html`
matches a fresh build and that it matches the committed `data/players.json`.

- [ ] **Step 6: Commit**

```bash
git add data/players.json data/fetched-at.json draft.html tests/players-data.test.js
git commit -m "chore: refresh player data, now carrying the ADP spread"
```

- [ ] **Step 7: State what a human still has to check**

Nothing in this chunk renders, so there is no browser check — say so explicitly rather than
leaving it unsaid. Do report the coverage numbers from Step 3, and flag any player where
`adp` is present but `adpStdev` is not, since that combination is what the next chunk will
have to omit a line for.

---

## Self-review

**Spec coverage.**

| Spec requirement (Chunk J) | Task |
|---|---|
| `adpStdev` from FFC `stdev` | 1 |
| `adpEarliest` / `adpLatest` from `min`/`max` of `high`/`low` | 1 |
| `adpDrafts` from `times_drafted` | 1 |
| All nullable; no FFC match means null throughout | 1 (two tests) |
| Naming carries the meaning so no consumer knows the convention | 1 (comment and test) |
| A test asserts `adpEarliest <= adpLatest` | 2 |
| Nothing reads the new fields in this chunk | Neither task touches `src/` |

**Placeholder scan.** No TBDs. Every code step carries its code, including the two object
literals that both need editing and the `num` helper.

**Type consistency.** `num()` returns `number | null` and is the only writer of all five
fields. The fixture tests assert `null` (not `undefined`) for absence, which is what
`num()` produces and what JSON round-trips. The shipped-data test accepts `null | number`
for each, matching.

**One risk worth naming.** Task 2 regenerates `data/players.json` wholesale, so its commit
mixes the new fields with a routine projection refresh. That is how this repo already works —
the daily cron commits exactly this shape of diff — but a reviewer reading the diff should be
told, or they will hunt for meaning in three hundred changed projections.
