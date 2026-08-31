# Handcuffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Know who backs up whom, so the app can filter the board down to the backups of your own starters and tell you, before you spend a pick, whether a player's handcuff is still there.

**Architecture:** ESPN publishes ranked depth charts whose athlete ids are the same ids `players.json` already uses, so a handcuff becomes a fact rather than an inference. The fetch gains a per-team step; each player gains `depthRank` and `backupId`; a new pure core module turns a roster into the set of ids that back up its starters; the centre panel gains a toggle and the recommendation card a line.

**Tech Stack:** Plain ES modules, no dependencies. `node --test` with `node:assert/strict`. The hand-written DOM stand-in at `tests/dom-stub.js`.

**Spec:** `docs/superpowers/specs/2026-08-31-handcuffs-stacks-and-odds-design.md` — the "Chunk K" section, plus "Measurements taken before writing this".

## Global Constraints

- Node >= 22. **Zero npm dependencies, permanently.**
- `draft.html` is a build artifact. **Never hand-edit it.** Only the final task runs `npm run build`; `tests/build.test.js` rebuilds in-process and asserts byte equality, and separately asserts the artifact matches `data/players.json`.
- Modules under `src/` may use **only** single-line `import { a } from './rel.js';` and `export function|const|class`. The bundler is a regex transform — a violation silently produces a broken page instead of a failing build. `scripts/` is not bundled.
- **Only Task 2 runs `npm run fetch`.** No other task may touch `data/players.json` or `data/fetched-at.json`.
- Every new field is nullable, and a null means "not known", never "no backup".
- **A handcuff is a fact from the depth chart, never an inference from projections.** "Same team, same position, lower projection" calls a committee-mate a handcuff, which is wrong in exactly the backfields that matter.

## Vocabulary

- **Depth chart** — `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{SEASON}/teams/{teamId}/depthcharts`. Returns `items`, an array of groups. Each group has a `name` and a `positions` object keyed by lowercase slot (`qb`, `rb`, `wr`, `te`, plus offensive line and, in other groups, defence and special teams). Each position holds `athletes`, each with a `rank` and an `athlete.$ref` URL ending in the athlete id.
- **The offensive group** — the one whose `positions` contain **both `qb` and `rb`**. Measured across four teams, the defensive group's name varies with scheme (`Base 3-4 D` / `Base 4-3 D`) while the offensive group happened to be `3WR 1TE` each time. **Never match on the name.**
- **Handcuff** — **at RB only**, the player at `rank + 1` on the same NFL team. Verified against Detroit: RB `1:Jahmyr Gibbs 2:Isiah Pacheco`. Corrected after the chunk K review: `rank + 1` is a depth fact at every position, but only at RB does it mean "inherits the workload" — WR `1:Amon-Ra St. Brown 2:Jameson Williams` is two starters, not a handcuff pair. See the spec's "What a handcuff is".
- **Startable starter** — a player occupying a non-`BN` slot in `assignSlots(roster, slots)`. A bench body's backup is not a handcuff in any useful sense.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/fetch-players.mjs` (modify) | Fetch 32 depth charts, build an athlete-id → `{depthRank, backupId}` map, emit both fields. |
| `data/players.json`, `data/fetched-at.json` (regenerated) | Task 2 only, via `npm run fetch`. |
| `src/core/handcuff.js` (new) | `handcuffIdsFor(roster, slots)` — the ids backing up this roster's starters. Pure. |
| `src/ui/center.js` (modify) | A `Handcuffs` toggle in `.filters`, ANDed into `visiblePlayers`, plus the empty-state sentence and a line on the recommendation card. |
| `src/ui/app.js` (modify) | Pass the handcuff id set into `renderCenter`. Only that: `ctx.pool` is already the available players and `ctx.tablePlayers` is already every player, so no id set is needed for either. |
| `src/styles.css` (modify) | One rule for the empty-state sentence. |
| `draft.html` (regenerated) | Final task only. |

---

## Task 1: Fetch the depth charts

**Files:**
- Modify: `scripts/fetch-players.mjs`
- Test: `tests/players-data.test.js`

**Interfaces:**
- Consumes: `getJson(url, headers)` and `mapWithConcurrency(items, limit, worker)`, both already in the file; `teamsJson.settings.proTeams`, which the fetch already downloads and which carries the team ids.
- Produces:
  - `export function depthMapFromCharts(chartsByTeam)` → `Map<athleteId, { depthRank, backupId }>`. `chartsByTeam` is an array of parsed depth-chart responses; a `null` entry means that team's fetch failed and is skipped.
  - `mergePlayers(espnJson, teamsJson, ffcJson, athletesById, depthById)` — a fifth parameter, defaulting to `new Map()`, so existing callers and every existing test keep working.
  - Every returned player gains `depthRank` (number or `null`) and `backupId` (string or `null`).

**Do not iterate a hardcoded list of team ids.** `teamsJson.settings.proTeams` already carries them and the fetch already parses it. Filter out any entry with a falsy `id` — the feed includes a placeholder for free agents.

**The join needs no team mapping at all.** Each chart response is self-contained: for one position group, sort its athletes by `rank`, and for each consecutive pair record `backupId[earlier] = later`. Nothing downstream needs to know which team a chart came from, so a mismatch between fantasy `proTeamId` and core-API team id cannot silently corrupt the map — it would simply produce a chart for a team we then attribute to nobody, which the coverage check in Task 2 would catch.

- [ ] **Step 1: Write the failing tests**

Add to `tests/players-data.test.js`:

```js
const chart = (groups) => ({ items: groups });
const athlete = (id, rank) => ({ rank, athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/${id}?lang=en` } });

test('depthMapFromCharts records each player rank and the player directly below him', () => {
  const charts = [chart([
    { name: '3WR 1TE', positions: {
      qb: { athletes: [athlete('goff', 1), athlete('backup-qb', 2)] },
      rb: { athletes: [athlete('gibbs', 1), athlete('pacheco', 2), athlete('third', 3)] },
    } },
  ])];
  const map = depthMapFromCharts(charts);
  assert.deepEqual(map.get('gibbs'), { depthRank: 1, backupId: 'pacheco' });
  assert.deepEqual(map.get('pacheco'), { depthRank: 2, backupId: 'third' });
  assert.deepEqual(map.get('third'), { depthRank: 3, backupId: null }, 'the last man backs up nobody');
});

test('the offensive group is found by its positions, never by its name', () => {
  // Measured: the defensive group is "Base 3-4 D" on some teams and "Base 4-3 D" on
  // others, and the offensive group's name is a formation that can change. Only the
  // positions are stable.
  const charts = [chart([
    { name: 'Base 3-4 D', positions: { lde: { athletes: [athlete('lineman', 1)] } } },
    { name: 'Special Teams', positions: { pk: { athletes: [athlete('kicker', 1)] } } },
    { name: 'Some Formation Nobody Predicted', positions: {
      qb: { athletes: [athlete('goff', 1)] },
      rb: { athletes: [athlete('gibbs', 1), athlete('pacheco', 2)] },
    } },
  ])];
  const map = depthMapFromCharts(charts);
  assert.equal(map.get('gibbs').backupId, 'pacheco');
  assert.equal(map.has('lineman'), false, 'defenders are not in the map');
  assert.equal(map.has('kicker'), false, 'and neither are kickers');
});

test('athletes are ordered by rank, not by the order the feed lists them', () => {
  // The feed order must NOT put the asserted pair next to each other, or the test
  // passes whether or not the sort happens.
  const charts = [chart([
    { name: '3WR 1TE', positions: {
      qb: { athletes: [athlete('goff', 1)] },
      rb: { athletes: [athlete('pacheco', 2), athlete('third', 3), athlete('gibbs', 1)] },
    } },
  ])];
  const map = depthMapFromCharts(charts);
  assert.equal(map.get('gibbs').backupId, 'pacheco');
  assert.equal(map.get('third').backupId, null, 'and the last man by rank backs up nobody');
});

test('only qb, rb, wr and te are mapped', () => {
  // K and DEF live in the Special Teams group, have no meaningful handcuff, and are
  // already excluded from the grade and the waiver list.
  const charts = [chart([
    { name: '3WR 1TE', positions: {
      qb: { athletes: [athlete('goff', 1)] },
      rb: { athletes: [athlete('gibbs', 1)] },
      wr: { athletes: [athlete('arsb', 1), athlete('jamo', 2)] },
      te: { athletes: [athlete('laporta', 1)] },
      lt: { athletes: [athlete('tackle', 1)] },
    } },
  ])];
  const map = depthMapFromCharts(charts);
  assert.equal(map.get('arsb').backupId, 'jamo');
  assert.equal(map.has('tackle'), false);
});

test('a team whose chart failed is skipped, not fatal', () => {
  const charts = [
    null,
    chart([{ name: '3WR 1TE', positions: {
      qb: { athletes: [athlete('goff', 1)] },
      rb: { athletes: [athlete('gibbs', 1), athlete('pacheco', 2)] },
    } }]),
  ];
  const map = depthMapFromCharts(charts);
  assert.equal(map.get('gibbs').backupId, 'pacheco', 'the teams that did resolve still count');
});

test('a chart with no offensive group contributes nothing rather than throwing', () => {
  const charts = [chart([{ name: 'Base 4-3 D', positions: { lde: { athletes: [athlete('x', 1)] } } }])];
  assert.equal(depthMapFromCharts(charts).size, 0);
});

test('mergePlayers attaches depth rank and backup id', () => {
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jahmyr Gibbs', defaultPositionId: 2, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 1 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 297.1 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const depth = new Map([['111', { depthRank: 1, backupId: '222' }]]);

  const [gibbs] = mergePlayers(espn, teams, { players: [] }, new Map(), depth);
  assert.equal(gibbs.depthRank, 1);
  assert.equal(gibbs.backupId, '222');
});

test('a player with no depth-chart entry gets null for both, not undefined', () => {
  const espn = { players: [{ player: {
    id: 333, fullName: 'Deep Sleeper', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 250 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 40 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const [p] = mergePlayers(espn, teams, { players: [] });
  assert.equal(p.depthRank, null);
  assert.equal(p.backupId, null);
});
```

Add `depthMapFromCharts` to the import at the top of the file.

You must also extend the existing `mergePlayers joins ESPN projections with FFC adp and team byes` test, whose whole-object `deepEqual` will now be missing two keys. Add `depthRank: null, backupId: null` to its expected object.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/players-data.test.js`
Expected: FAIL — `depthMapFromCharts is not a function`, plus two missing keys in the `deepEqual`.

- [ ] **Step 3: Implement `depthMapFromCharts`**

Add to `scripts/fetch-players.mjs`, above `mergePlayers`:

```js
// K and DEF live in the Special Teams group and have no meaningful handcuff — they are
// streamed off waivers, and the grade already ignores them.
const DEPTH_POSITIONS = ['qb', 'rb', 'wr', 'te'];

// The offensive group is identified by the positions it contains, never by its name:
// measured across four teams, the defensive group is "Base 3-4 D" on some and
// "Base 4-3 D" on others, and a formation name like "3WR 1TE" is not a contract.
function offensiveGroup(chartJson) {
  return (chartJson.items || []).find(
    (group) => group.positions && group.positions.qb && group.positions.rb,
  ) || null;
}

function athleteIdFromRef(entry) {
  const ref = entry && entry.athlete && entry.athlete.$ref;
  const match = typeof ref === 'string' ? ref.match(/athletes\/(\d+)/) : null;
  return match ? match[1] : null;
}

// Each chart is self-contained: the pairs come from consecutive ranks within one
// position group, so nothing here needs to know which team a chart came from. That
// keeps a mismatch between fantasy proTeamId and core-API team id from silently
// corrupting the map — a chart for the wrong team would simply attribute to nobody.
export function depthMapFromCharts(chartsByTeam) {
  const map = new Map();
  for (const chartJson of chartsByTeam) {
    if (!chartJson) continue;
    const group = offensiveGroup(chartJson);
    if (!group) continue;
    for (const position of DEPTH_POSITIONS) {
      const slot = group.positions[position];
      if (!slot || !Array.isArray(slot.athletes)) continue;
      const ordered = [...slot.athletes]
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => ({ id: athleteIdFromRef(entry), rank: entry.rank }))
        .filter((entry) => entry.id);
      ordered.forEach((entry, i) => {
        const next = ordered[i + 1];
        map.set(entry.id, { depthRank: entry.rank, backupId: next ? next.id : null });
      });
    }
  }
  return map;
}
```

- [ ] **Step 4: Emit the two fields**

Give `mergePlayers` a fifth parameter and use it. The signature becomes:

```js
export function mergePlayers(espnJson, teamsJson, ffcJson, athletesById = new Map(), depthById = new Map()) {
```

Inside the loop, beside the existing `const ffc = ...` line:

```js
    const depth = depthById.get(String(p.id)) || null;
```

Add to the **first** object literal, after the ADP fields:

```js
      depthRank: depth ? depth.depthRank : null,
      // May point at a player outside the 400-player pool. That is not an error — it
      // means the handcuff is not draftable here, and the UI omits rather than invents.
      backupId: depth ? depth.backupId : null,
```

Add the same two keys to the **second** object literal, the one inside the final
`merged.map(...)` that builds the shipped shape, directly after `adpDrafts: p.adpDrafts,`:

```js
      depthRank: p.depthRank,
      backupId: p.backupId,
```

Forgetting the second literal is the known trap in this file; it happened to be caught by
fixtures last time and would be again, but do not rely on that.

- [ ] **Step 5: Wire the fetch step**

Add the URL beside the other constants at the top:

```js
const ESPN_DEPTH = (teamId) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/teams/${teamId}/depthcharts`;
```

In `main`, after the teams response is available and before `mergePlayers` is called:

```js
  console.log('Fetching depth charts...');
  const teamIds = teams.settings.proTeams.map((t) => t.id).filter(Boolean);
  const charts = await mapWithConcurrency(teamIds, ATHLETE_CONCURRENCY, async (teamId) => {
    // One team's chart failing must not fail the run — but it must be visible, because
    // silently shipping 31 of 32 is the failure this reports on.
    try {
      return await getJson(ESPN_DEPTH(teamId));
    } catch {
      return null;
    }
  });
  const depthById = depthMapFromCharts(charts);
  const resolved = charts.filter(Boolean).length;
  console.log(`Depth charts: ${resolved} of ${teamIds.length} teams, ${depthById.size} players ranked`);
```

Then pass it: `mergePlayers(espn, teams, ffc, athletesById, depthById)`.

`ATHLETE_CONCURRENCY` is the constant the existing athlete fetch already uses (see the
`mapWithConcurrency` calls in `main`). Reuse it rather than inventing a second number: 32
requests is a tenth of what that path already issues at the same rate.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/players-data.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green. `data/players.json` has not been regenerated, so the shipped-data
schema test still passes against a shape without the new fields.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-players.mjs tests/players-data.test.js
git commit -m "feat(fetch): read the NFL depth charts, so a handcuff is a fact"
```

---

## Task 2: Refresh the data so the depth fields ship

**Files:**
- Modify: `tests/players-data.test.js` (the shipped-data schema test)
- Regenerate: `data/players.json`, `data/fetched-at.json`

**This task makes network calls, and that is the point.** Same shape as chunk J's refresh
task. `npm run fetch` is the supported path and is what the daily cron runs.

**If the fetch fails, or the coverage check below does not hold, stop and report.** Do not
hand-write fields into `data/players.json`. `git checkout data/players.json
data/fetched-at.json` restores the committed state.

- [ ] **Step 1: Fetch**

Run: `npm run fetch`

Expected: among its output, the new line `Depth charts: 32 of 32 teams, N players ranked`.
Fewer than 32 teams is a partial result — report the number and stop rather than committing
a pool where some teams have no handcuffs at all, which would look like "no backup" rather
than "not known".

- [ ] **Step 2: Verify the join actually landed**

Run:

```bash
node -e "
const P=require('./data/players.json');
const skill=P.filter(p=>['QB','RB','WR','TE'].includes(p.position));
const ranked=skill.filter(p=>p.depthRank!==null);
console.log('players',P.length,'| skill',skill.length,'| with depthRank',ranked.length);
console.log('with backupId',skill.filter(p=>p.backupId!==null).length);
const inPool=new Set(P.map(p=>p.id));
const pointing=skill.filter(p=>p.backupId!==null);
console.log('backupId resolves inside the pool:',pointing.filter(p=>inPool.has(p.backupId)).length,'of',pointing.length);
const rb1=skill.filter(p=>p.position==='RB'&&p.depthRank===1).length;
console.log('RB1s:',rb1,'(expect roughly one per team)');
const self=skill.filter(p=>p.backupId===p.id); console.log('players backing up themselves:',self.length);
"
```

Expected: several hundred skill players with a `depthRank`; roughly 32 RB1s; **zero**
players backing up themselves; and a meaningful fraction of `backupId`s resolving inside
the pool — some will not, because deep backups fall outside the top 400, and that is
expected rather than a fault. A `depthRank` count of zero means the join failed; stop.

- [ ] **Step 3: Tighten the schema test**

In `tests/players-data.test.js`, inside the shipped-data test's per-player loop:

```js
    assert.ok(p.depthRank === null || typeof p.depthRank === 'number', `${p.name} depthRank`);
    assert.ok(p.backupId === null || typeof p.backupId === 'string', `${p.name} backupId`);
    assert.ok(p.backupId !== p.id, `${p.name} is listed as his own backup`);
```

And after the loop:

```js
  // A join that silently stopped matching would leave every skill player unranked while
  // every check above still passed — the fields are nullable by design — and the
  // handcuff filter would simply always be empty, with nothing to say why.
  const skill = players.filter((p) => ['QB', 'RB', 'WR', 'TE'].includes(p.position));
  const ranked = skill.filter((p) => p.depthRank !== null).length;
  assert.ok(
    ranked >= skill.length * 0.5,
    `only ${ranked} of ${skill.length} skill players have a depth-chart rank — the ESPN join has broken`,
  );
```

**Do not assert a tighter fraction than you measured in Step 2.** A pool of 400 reaches
well past every team's listed depth, so a large minority legitimately have no rank. Set the
floor below what you actually observed and say in your report what the real figure was.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all green **except** `tests/build.test.js`, which fails because `draft.html` is
now stale against the refreshed data. The final task rebuilds. If anything else fails, fix
it before committing.

- [ ] **Step 5: Commit**

```bash
git add data/players.json data/fetched-at.json tests/players-data.test.js
git commit -m "chore: refresh player data, now carrying depth-chart ranks"
```

Note in your report that the refresh rewrites every projection, not just the new fields, so
a reviewer reading hundreds of changed lines knows which ones are the point. If the refresh
moves any other hardcoded fixture, recompute it, say so, and check whether that fixture
should exist at all — chunk J deleted one that was gating the daily cron.

---

## Task 3: Whose backups are these

**Files:**
- Create: `src/core/handcuff.js`
- Test: create `tests/handcuff.test.js`

**Interfaces:**
- Consumes: `assignSlots(players, slots)` from `src/core/roster.js`.
- Produces: `handcuffIdsFor(roster, slots)` → `Set<string>` of the `backupId`s of this roster's **startable starters**.

- [ ] **Step 1: Write the failing test**

Create `tests/handcuff.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handcuffIdsFor } from '../src/core/handcuff.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points, backupId = null) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye: 9, backupId,
});

test('a starter\'s backup is a handcuff', () => {
  const roster = [pl('gibbs', 'RB', 250, 'pacheco')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['pacheco']);
});

test('a bench player\'s backup is not', () => {
  // DEFAULT_SLOTS starts one QB. The second is depth, and depth for depth is not a
  // handcuff in any sense worth a button.
  const roster = [pl('q1', 'QB', 300, 'q1-backup'), pl('q2', 'QB', 290, 'q2-backup')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['q1-backup']);
});

test('a FLEX starter counts, because he starts', () => {
  const roster = [pl('a', 'RB', 200, 'a2'), pl('b', 'RB', 180, 'b2'), pl('c', 'RB', 160, 'c2')];
  // RB1, RB2 and FLEX are all filled, so all three are starters.
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)].sort(), ['a2', 'b2', 'c2']);
});

test('a starter with no known backup contributes nothing', () => {
  const roster = [pl('gibbs', 'RB', 250, null)];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});

test('an empty roster yields an empty set, never a throw', () => {
  assert.equal(handcuffIdsFor([], DEFAULT_SLOTS).size, 0);
});

test('two starters sharing a backup list him once', () => {
  const roster = [pl('a', 'RB', 200, 'same'), pl('b', 'RB', 180, 'same')];
  assert.deepEqual([...handcuffIdsFor(roster, DEFAULT_SLOTS)], ['same']);
});

test('a kicker\'s backup is not a handcuff', () => {
  // K and DEF are streamed, are excluded from the grade, and have no depth entry —
  // but a stale backupId on one must not leak into the filter.
  const roster = [pl('k', 'K', 171.7, 'k2')];
  assert.equal(handcuffIdsFor(roster, DEFAULT_SLOTS).size, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/handcuff.test.js`
Expected: FAIL — `Cannot find module '../src/core/handcuff.js'`.

- [ ] **Step 3: Implement**

Create `src/core/handcuff.js`:

```js
import { assignSlots } from './roster.js';

// The positions a handcuff means anything for. K and DEF are streamed off waivers week
// to week, are already out of the grade, and have no depth-chart entry — but a stale id
// on one must not leak into the filter.
export const HANDCUFF_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// The ids that back up this roster's STARTERS. assignSlots, not a re-derivation: the
// grade, the roster panel, the report card and this all have to agree about who starts,
// and sharing the one function is what makes disagreeing impossible.
//
// Starters only. A second quarterback's backup is depth for depth, which is not what
// anyone means by a handcuff and would fill the filter with noise.
export function handcuffIdsFor(roster, slots) {
  const ids = new Set();
  for (const slot of assignSlots(roster, slots)) {
    if (!slot.player || slot.label.startsWith('BN')) continue;
    if (!HANDCUFF_POSITIONS.includes(slot.player.position)) continue;
    if (slot.player.backupId) ids.add(slot.player.backupId);
  }
  return ids;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/handcuff.test.js`
Expected: PASS, 7 tests.

Then `npm test`: green **except** `tests/build.test.js`. The bundler inlines every file
under `src/`, reachable or not, so creating `handcuff.js` makes `draft.html` stale the
moment it exists — before anything imports it. Task 5 owns the rebuild. Do not run
`npm run build` to make this go away.

- [ ] **Step 5: Commit**

```bash
git add src/core/handcuff.js tests/handcuff.test.js
git commit -m "feat(handcuff): the ids backing up a roster's starters"
```

---

## Task 4: The filter

**Files:**
- Modify: `src/ui/center.js`, `src/ui/app.js`, `src/styles.css`
- Test: `tests/center.test.js`, `tests/render-center.test.js`

**Interfaces:**
- Consumes: `handcuffIdsFor(roster, slots)` from Task 3.
- Produces: `renderCenter`'s `ctx` gains `handcuffIds` (a `Set<string>`, optional — default to an empty set so existing callers and tests keep working). `visiblePlayers(tablePlayers, handcuffIds)` gains a second parameter with the same default.

**The toggle is ANDed with the position buttons**, per the spec: with `RB` selected and
`Handcuffs` on, you see your RB handcuffs only. It is a separate button from the position
chips, exactly as `Available only` is — the comment at `src/ui/center.js:302` explains why
folding a non-position filter into that multi-select row collides.

- [ ] **Step 1: Write the failing tests**

**The view state is module-private and has no setters, by design.** `src/ui/center.js`
exports `resetView` and nothing else that writes `view`; `tests/center.test.js` imports
only the pure helpers (`sortPlayers`, `filterByPositions`, `formatVbd`, `SORT_KEYS`,
`setScrollHint`), and the existing `availableOnly` toggle is covered by driving
`renderCenter` and clicking the button. **Follow that.** Do not add test-only setters — a
second mechanism for writing `view` is exactly the kind of API that exists only to be
tested and then drifts from what the app does.

So: one direct test of the default (filter off) in `tests/center.test.js`, and the rest
through the button in `tests/render-center.test.js`.

Add to `tests/center.test.js` (extending its import to include `visiblePlayers` and
`resetView`):

```js
test('with the handcuff filter off, the handcuff set is ignored entirely', () => {
  // The default. A set is always passed in; it must not filter until asked.
  resetView();
  const pool = [
    { id: 'pacheco', name: 'Isiah Pacheco', position: 'RB', overallRank: 90, projectedPoints: 120, ownerName: null },
    { id: 'someone', name: 'Someone Else', position: 'RB', overallRank: 91, projectedPoints: 118, ownerName: null },
  ];
  assert.equal(visiblePlayers(pool, new Set(['pacheco'])).length, 2);
  assert.equal(visiblePlayers(pool).length, 2, 'and the argument is optional');
});
```

Add to `tests/render-center.test.js`, driving the button the way the existing toggle tests
do — `resetView()` first, then render, then click:

```js
test('the handcuff button filters the table to your starters\' backups', () => {
  resetView();
  const c = document.createElement('div');
  renderCenter(c, { ...BASE_CTX, handcuffIds: new Set(['pacheco']) }, HANDLERS);
  const button = find(c, (n) => n.tagName === 'button' && /handcuff/i.test(n.textContent))[0];
  assert.ok(button, 'the button exists');
  button.listeners.click[0]();
  const names = find(c, (n) => n.className === 'pname').map((n) => n.textContent);
  assert.ok(names.every((n) => /pacheco/i.test(n)), `expected only the handcuff, got ${names}`);
});

test('the handcuff filter is ANDed with the position buttons', () => {
  // "My handcuffs, among RBs" is the question, and a position chip cannot express it.
  resetView();
  const c = document.createElement('div');
  renderCenter(c, { ...BASE_CTX, handcuffIds: new Set(['pacheco', 'jamo']) }, HANDLERS);
  find(c, (n) => n.tagName === 'button' && n.textContent === 'RB')[0].listeners.click[0]();
  find(c, (n) => n.tagName === 'button' && /handcuff/i.test(n.textContent))[0].listeners.click[0]();
  const rows = find(c, (n) => n.className === 'pname').map((n) => n.textContent);
  assert.ok(rows.every((n) => !/jamo/i.test(n)), `a WR handcuff survived an RB filter: ${rows}`);
});
```

`BASE_CTX`, `HANDLERS`, `find` and the row class used for a player name are whatever that
file already defines — **read it and match, do not assume the names above are right.**
Its pool fixture must contain the ids you assert on; extend it rather than replacing it.

Add to `tests/render-center.test.js`:

```js
test('the handcuff button says why the list is empty rather than showing nothing', () => {
  // An empty table reads as a bug. The one thing the user needs to know is whether the
  // filter found nothing or they have no startable starters yet.
  const c = document.createElement('div');
  renderCenter(c, { ...BASE_CTX, handcuffIds: new Set() }, HANDLERS);
  const button = find(c, (n) => n.tagName === 'button' && /handcuff/i.test(n.textContent))[0];
  assert.ok(button, 'the button exists');
  button.listeners.click[0]();
  const text = find(c, () => true).map((n) => n.textContent || '').join(' ');
  assert.match(text, /handcuff/i);
});
```

Adapt `BASE_CTX`, `HANDLERS` and `find` to whatever that file already defines — again,
read it first and match it.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/center.test.js tests/render-center.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the filter**

In `src/ui/center.js`, add `handcuffsOnly: false` to `DEFAULT_VIEW`, then extend
`visiblePlayers`:

```js
export function visiblePlayers(tablePlayers, handcuffIds = new Set()) {
  const hasQuery = view.query.trim().length > 0;
  return filterByPositions(sortPlayers(tablePlayers, view.sortKey), view.positions)
    .filter((pl) => matchesQuery(pl, view.query))
    .filter((pl) => hasQuery || !view.availableOnly || !isTaken(pl))
    // ANDed with the position buttons, not folded into them: "my handcuffs, among RBs"
    // is the question, and a position chip cannot express it.
    .filter((pl) => !view.handcuffsOnly || handcuffIds.has(pl.id));
}
```

Every call site of `visiblePlayers` inside `center.js` must pass the set through — there
are three, including the one that builds the heading count. A missed one shows a count
that disagrees with the rows beneath it.

- [ ] **Step 4: Add the button and the empty state**

Beside the `Available only` button:

```js
  const handcuffBtn = el('button', {
    class: view.handcuffsOnly ? 'selected' : '',
    text: 'Handcuffs',
    title: 'Show only the backups to the players in your starting lineup',
    onClick: () => { view.handcuffsOnly = !view.handcuffsOnly; rerender(); },
  }, []);
```

And where the table is appended, when the filter is on and the result is empty, append a
sentence instead of an empty table:

```js
  // An empty table reads as a bug. Which of the two reasons it is matters: one resolves
  // itself as you draft, the other means the board genuinely has nothing.
  function handcuffEmptyNote() {
    if (!view.handcuffsOnly || visiblePlayers(tablePlayers, handcuffIds).length > 0) return null;
    const text = handcuffIds.size === 0
      ? 'No handcuffs yet — this shows the backups to players in your starting lineup, once you have some.'
      : 'None of your starters\' backups are still on the board.';
    return el('div', { class: 'empty-note', text }, []);
  }
```

Append its result (when not null) directly after the table, and rebuild it in
`redrawTable` alongside the heading count so it tracks the filter.

> **Corrected by the fix wave, twice.** (a) Two cases is wrong — the variant must be
> decided against the unfiltered available `pool`, not the filtered rows, or every other
> active filter claims your handcuffs have been drafted; and "still on the board" must not
> be said about a backup who is outside the top 400 and was never listed. Four cases now.
> (b) The note goes *inside* `.tablewrap`, not after it: appended to the panel's flex
> column it renders below a full-height empty table and gets clipped on a short viewport.
> See `tableSection` in `src/ui/center.js`.

- [ ] **Step 5: Wire it in app.js**

Add the import as its own single line:

```js
import { handcuffIdsFor } from '../core/handcuff.js';
```

In `renderDraft`, beside the existing `myRoster` computation, derive the set and pass it in
`renderCenter`'s ctx as `handcuffIds`. Use the roster and slots already in scope.

- [ ] **Step 6: Style the note**

Append to `src/styles.css` — but **check where the `@media print` block closes first**.
That block is near the end of the file, and a naive append lands inside it, giving a rule
that only exists on paper.

```css
/* Shown in place of an empty table when the handcuff filter has nothing to list. */
.empty-note { padding: 12px 8px; color: var(--muted); font-size: 13px; }
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: green except `tests/build.test.js`, which the final task fixes.

- [ ] **Step 8: Commit**

```bash
git add src/ui/center.js src/ui/app.js src/styles.css tests/
git commit -m "feat(center): filter the board to your starters' backups"
```

---

## Task 5: The recommendation flag, and the rebuild

**Files:**
- Modify: `src/ui/center.js` (the recommendation card)
- Test: `tests/render-center.test.js`
- Regenerate: `draft.html`

**Interfaces:**
- Consumes: `pool` — already passed to `renderCenter` and already the list of *available*
  players, so "his backup is still on the board" is answerable without any new plumbing.

**It is a line on the card, not a reason.** `reasonsFor` in `src/core/recommend.js` slices
to two entries, and a handcuff is not a reason to draft anyone — it is a fact about what
happens next. `byeWarning` at `src/ui/center.js:71` is the existing model for exactly this:
a secondary line, rendered from the card, with its own class. Follow it. **Do not touch
`src/core/recommend.js`.**

- [ ] **Step 1: Write the failing test**

Add to `tests/render-center.test.js`:

```js
test('a recommendation says when the player\'s own backup is still available', () => {
  // The useful direction: it tells you the insurance exists before you spend the pick.
  const c = document.createElement('div');
  renderCenter(c, { ...BASE_CTX, pool: [BACKED_UP_STARTER, THE_BACKUP] }, HANDLERS);
  const text = find(c, () => true).map((n) => n.textContent || '').join(' ');
  assert.match(text, /backup/i);
  assert.match(text, new RegExp(THE_BACKUP.name));
});

test('no line when the backup has already gone', () => {
  const c = document.createElement('div');
  renderCenter(c, { ...BASE_CTX, pool: [BACKED_UP_STARTER] }, HANDLERS);
  const text = find(c, () => true).map((n) => n.textContent || '').join(' ');
  assert.doesNotMatch(text, /backup/i, 'omit rather than say "no backup available"');
});
```

Define `BACKED_UP_STARTER` and `THE_BACKUP` as fixtures in that file's existing style, with
`BACKED_UP_STARTER.backupId === THE_BACKUP.id`, and make sure the starter is one the
recommendation actually returns for `BASE_CTX` — check what that context produces before
asserting on it, rather than assuming.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/render-center.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/ui/center.js`, beside `byeWarning`:

```js
// A fact about what happens next, not a reason to draft him — which is why it is a line
// on the card rather than an entry in reasonsFor, whose two slots are for reasons. The
// pool passed in is already the available players, so membership is the whole check.
function backupNote(player, pool) {
  if (!player.backupId) return null;
  const backup = pool.find((pl) => pl.id === player.backupId);
  return backup
    ? el('div', { class: 'backup-note', text: `Handcuff available: ${backup.name}` }, [])
    : null;
}
```

Call it from `recommendationCard` next to the existing `byeWarning(...)` call, appending
its result when not null. Pass `pool` through to the card if it is not already a parameter.

> **Corrected by the fix wave:** the guard is
> `if (!player.backupId || !HANDCUFF_POSITIONS.includes(player.position)) return null;`.
> Ungated, this line was false on the four most-viewed cards in the app — a handcuff is a
> running-back fact. See the spec's "What a handcuff is".

Append to `src/styles.css`:

```css
/* Same weight as the bye warning: a secondary fact under the reasons, not a reason. */
.rec .backup-note { color: var(--muted); font-size: 11.5px; margin-top: 3px; }
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/render-center.test.js`
Expected: PASS.

- [ ] **Step 5: Rebuild**

Run: `npm run build`

This is the only task that runs the build and the only commit that may contain
`draft.html`. Never hand-edit it.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: **fully green**, `tests/build.test.js` included — it rebuilds in-process and
asserts byte equality, so it is the proof the shipped page matches the source and the
committed data.

- [ ] **Step 7: Commit**

```bash
git add src/ui/center.js src/styles.css tests/render-center.test.js draft.html
git commit -m "feat(center): say when a recommendation's own handcuff is still there"
```

- [ ] **Step 8: State the browser check**

`tests/dom-stub.js` has no layout engine, so nothing above can see whether any of this
looks right. Report explicitly that a human must check:

- the `Handcuffs` button sits sensibly in the filter row and does not push it to wrap
- the empty-state sentence reads as an explanation rather than an error
- the extra line on a recommendation card does not push the third card out of the
  scrollport — the recommendations panel has shipped a layout bug of exactly that kind
  before, and no test in this repo could see it

---

## Self-review

**Spec coverage.**

| Spec requirement (Chunk K) | Task |
|---|---|
| 32 depth-chart requests alongside the existing fetch | 1 |
| Offensive group found by positions, never by name | 1 (test) |
| `depthRank` and `backupId`, both nullable | 1 |
| `backupId` may point outside the pool; not an error | 1 (comment), 2 (verified) |
| A failed team is skipped, and the count is reported | 1 (test and log line) |
| Handcuffs of *mine*, from startable starters only | 3 |
| Filter ANDed with the position buttons | 4 (test) |
| An empty result explains itself | 4 |
| Recommendation line when the backup is available | 5 |
| K and DEF excluded | 1 (`DEPTH_POSITIONS`), 3 (`HANDCUFF_POSITIONS`) |

**Placeholder scan.** No TBDs. Two steps deliberately say "read the existing test file and
match its pattern" rather than inventing fixtures blind — that is an instruction, not a
placeholder, and it exists because three fixture defects in earlier chunks came from
guessing at a file's conventions instead of reading them.

**Type consistency.** `backupId` is a string everywhere (`String(p.id)` on the ESPN side,
and the depth map's ids come from a `\d+` capture, so both are strings). `handcuffIdsFor`
returns a `Set<string>` and `visiblePlayers` calls `.has(pl.id)` on it, where `pl.id` is
also a string. `depthMapFromCharts` takes an array and returns a Map; `mergePlayers` takes
that Map as its fifth argument.

**Risks worth naming.**

1. **Task 2 regenerates the whole pool**, so its commit mixes the new fields with a routine
   projection refresh, and may move another hardcoded fixture. Chunk J deleted one that was
   gating the daily cron; if another surfaces, ask whether it should exist rather than
   pasting new numbers into it.
2. **The `Handcuffs` button does nothing in round 1**, by design — you own no starters yet.
   The empty-state sentence is what keeps that from reading as a broken button, which is
   why it is a requirement and not a nicety.
3. **`backupId` pointing outside the top 400 is common**, and both consumers handle it by
   omission. Neither should ever render "no handcuff available"; the absence of a line is
   the message.
