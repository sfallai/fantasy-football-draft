# Fantasy Football Draft Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency, single-file browser app that tracks a live 10-team standard-scoring snake draft and recommends picks from a composite of BPA, positional need, and VBD.

**Architecture:** Source lives as small ES modules under `src/` — a pure-logic `src/core/` layer (snake math, roster/needs, VBD, recommendation, competitive awareness, state) that is unit-tested with Node's built-in test runner, and a DOM layer under `src/ui/`. A ~90-line zero-dependency Node bundler (`scripts/build.mjs`) inlines every module, the CSS, and the player JSON into one self-contained `draft.html` that opens by double-click from `file://`. A separate Node script (`scripts/fetch-players.mjs`) pulls live 2026 rankings, projections, and ADP from three public no-auth endpoints into `data/players.json`, and can be re-run the morning of the draft.

**Tech Stack:** Vanilla JavaScript (ES2022 modules), Node.js 25 (`node --test`, global `fetch`), plain CSS, `localStorage`. No npm dependencies, no `package.json` dependencies section, no bundler library, no framework.

**Spec:** `docs/superpowers/specs/2026-08-23-fantasy-draft-assistant-design.md`

## Global Constraints

- **Draft date: August 29, 2026.** `data/players.json` must be regenerable in one command on draft morning.
- **Zero runtime dependencies.** `draft.html` must contain no `<script src>`, no `<link href>`, no `fetch()`, no network access of any kind.
- **Zero build/test dependencies.** No npm packages. Tests run via `node --test tests/`. Build runs via `node scripts/build.mjs`.
- **`draft.html` must work from `file://`** by double-click in Chrome and Safari — no local server.
- **Node 25.2.1** is installed. Use ESM (`.mjs` for scripts, `.js` with `"type": "module"` in `package.json` for `src/` and `tests/`).
- **Restricted module syntax in `src/`** so the regex bundler in Task 8 is safe. Only these forms are permitted anywhere under `src/`:
  - `import { a, b } from './rel/path.js';` — named only, relative only, `.js` extension required, single line.
  - `export function name(...)`, `export const name = ...`, `export class Name`.
  - **Forbidden:** default exports, `export { a, b }` lists, `export * from`, `import * as ns`, dynamic `import()`, bare-specifier imports, multi-line import statements.
- **League defaults** (from spec): 10 teams, standard non-PPR, snake, 15 rounds, ESPN, 1 optional keeper per team, roster slots `QB 1, RB 2, WR 2, TE 1, FLEX 1, K 1, DEF 1, BENCH 6`.
- **Position color coding**, used identically in every UI module: QB `#ef4444` (red), RB `#3b82f6` (blue), WR `#22c55e` (green), TE `#f97316` (orange), K `#9ca3af` (gray), DEF `#9ca3af` (gray).
- **Dark theme only.** Background `#0f1116`, panel `#181b23`, border `#2a2f3a`, text `#e6e8ed`, muted text `#8b93a5`, accent `#fbbf24`.
- **Laptop viewport only.** Target 1280×800 minimum. No mobile breakpoints.
- **Team indices are 1-based** everywhere (`teamIndex` 1..numTeams). **Overall pick numbers are 1-based** (`overallPick` 1..numTeams*rounds). **Rounds are 1-based.** Never deviate.
- **Player identity is `player.id`**, a string, sourced from the ESPN player id (or `DEF-<TEAM>` for defenses). Never match on name at runtime.

---

## Verified Data Sources

All three endpoints were called successfully on 2026-08-23 and require no authentication, no API key, and no headers beyond a `User-Agent` (and one `x-fantasy-filter` header for ESPN).

| Source | URL | Provides |
|---|---|---|
| ESPN player info | `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/1?view=kona_player_info` | 300 players: id, fullName, position id, proTeamId, **STANDARD overall draft rank**, **2026 projected fantasy points** |
| ESPN pro teams | `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl` | 33 entries: proTeamId → `abbrev`, `byeWeek` |
| FFC ADP | `https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=10&year=2026&position=all` | 216 players: name, position, team, **`adp`** (10-team non-PPR), `adp_formatted`, `times_drafted` |

Known quirks confirmed by inspection, which the fetch script must handle:

- ESPN `defaultPositionId`: `1=QB, 2=RB, 3=WR, 4=TE, 5=K, 16=DEF`.
- ESPN projected points live at `player.stats[]` where `seasonId === 2026 && statSourceId === 1 && statSplitTypeId === 0`, field `appliedTotal`. `leaguedefaults/1` is standard (non-PPR) scoring.
- ESPN defense names are `"Seahawks D/ST"`; FFC defense names are `"Seattle Defense"`. **Defenses must be joined on team abbrev, not name.**
- FFC uses position `"PK"` for kickers; ESPN uses `"K"`. Normalize FFC `PK` → `K`.
- Bye weeks come only from the ESPN pro-teams endpoint, keyed by `proTeamId`.
- ESPN returns 300 players (WR 104, RB 90, TE 34, QB 32, DEF 22, K 18). FFC returns 216. Players present in ESPN but absent from FFC get `adp: null`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `{"type": "module"}` + scripts. No dependencies. |
| `scripts/fetch-players.mjs` | Fetch + merge the three endpoints → `data/players.json`. |
| `scripts/build.mjs` | Inline CSS + JSON + all `src/` modules → `draft.html`. |
| `data/players.json` | Generated player pool, committed. |
| `src/core/snake.js` | Snake draft order math. Pure. |
| `src/core/roster.js` | Slot assignment + positional need tiers. Pure. |
| `src/core/vbd.js` | Replacement levels + value over replacement. Pure. |
| `src/core/recommend.js` | Composite score, ranking, "why" strings. Pure. |
| `src/core/competitive.js` | Other-team need inference + run warnings. Pure. |
| `src/core/state.js` | Draft state, apply/undo pick, keepers, localStorage. |
| `src/ui/dom.js` | `el()` helper, position colors, formatting helpers. |
| `src/ui/setup.js` | Setup screen. |
| `src/ui/myteam.js` | Left panel: roster + needs. |
| `src/ui/center.js` | Center panel: pick entry, recommendations, available list. |
| `src/ui/board.js` | Right panel: 10×15 grid. |
| `src/ui/app.js` | Wiring, render loop, entry point. |
| `src/index.html` | Page shell (build template). |
| `src/styles.css` | All styling. |
| `tests/*.test.js` | One test file per core module + one for the bundler. |
| `draft.html` | Built artifact, committed. |
| `README.md` | How to refresh data, build, and run on draft day. |

---

## Task 1: Project scaffold and player data pipeline

**Files:**
- Create: `package.json`
- Create: `scripts/fetch-players.mjs`
- Create: `data/players.json` (generated)
- Create: `tests/players-data.test.js`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `data/players.json` — an array of player objects with this exact schema, consumed by every later task:
  ```js
  {
    id: "4429795",        // string, ESPN player id, or "DEF-SEA" for defenses
    name: "Jahmyr Gibbs",
    team: "DET",          // NFL team abbrev
    position: "RB",       // one of QB|RB|WR|TE|K|DEF
    overallRank: 1,       // integer, 1-based, dense over the whole pool
    positionRank: 1,      // integer, 1-based, within position
    projectedPoints: 297.1,
    adp: 1.4,             // number or null when absent from FFC
    bye: 6                // integer or null
  }
  ```
  Also produces `scripts/fetch-players.mjs` exporting `normalizeName(s)`, `mergePlayers(espnJson, teamsJson, ffcJson)`.

- [ ] **Step 1: Create `package.json` and `.gitignore`**

`package.json`:
```json
{
  "name": "fantasy-football-draft",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "fetch": "node scripts/fetch-players.mjs",
    "build": "node scripts/build.mjs",
    "test": "node --test tests/"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

- [ ] **Step 2: Write the failing test**

Create `tests/players-data.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeName, mergePlayers } from '../scripts/fetch-players.mjs';

test('normalizeName strips punctuation, case, and suffixes', () => {
  assert.equal(normalizeName("Ka'imi Fairbairn"), 'kaimifairbairn');
  assert.equal(normalizeName('Marvin Harrison Jr.'), 'marvinharrison');
  assert.equal(normalizeName('A.J. Brown'), 'ajbrown');
});

test('mergePlayers joins ESPN projections with FFC adp and team byes', () => {
  const espn = {
    players: [
      {
        player: {
          id: 111, fullName: 'Jahmyr Gibbs', defaultPositionId: 2, proTeamId: 8,
          draftRanksByRankType: { STANDARD: { rank: 1 } },
          stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 297.1 }],
        },
      },
      {
        player: {
          id: 222, fullName: 'Seahawks D/ST', defaultPositionId: 16, proTeamId: 26,
          draftRanksByRankType: { STANDARD: { rank: 120 } },
          stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 104.0 }],
        },
      },
    ],
  };
  const teams = { settings: { proTeams: [
    { id: 8, abbrev: 'DET', byeWeek: 6 },
    { id: 26, abbrev: 'SEA', byeWeek: 11 },
  ] } };
  const ffc = { players: [
    { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 1.4 },
    { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 133.2 },
  ] };

  const out = mergePlayers(espn, teams, ffc);
  assert.equal(out.length, 2);

  const gibbs = out.find((p) => p.name === 'Jahmyr Gibbs');
  assert.deepEqual(gibbs, {
    id: '111', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
    overallRank: 1, positionRank: 1, projectedPoints: 297.1, adp: 1.4, bye: 6,
  });

  const def = out.find((p) => p.position === 'DEF');
  assert.equal(def.id, 'DEF-SEA', 'defenses get a team-derived id');
  assert.equal(def.adp, 133.2, 'defenses join on team abbrev, not name');
  assert.equal(def.bye, 11);
  assert.equal(def.overallRank, 2, 'overallRank is dense over the returned pool');
});

test('mergePlayers leaves adp null when FFC has no entry', () => {
  const espn = { players: [{ player: {
    id: 333, fullName: 'Deep Sleeper', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 250 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 40 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const out = mergePlayers(espn, teams, { players: [] });
  assert.equal(out[0].adp, null);
});

test('generated data/players.json matches the schema and covers all positions', () => {
  const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
  assert.ok(players.length >= 200, `expected >=200 players, got ${players.length}`);

  const positions = new Set(players.map((p) => p.position));
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    assert.ok(positions.has(pos), `missing position ${pos}`);
  }

  const ids = new Set();
  for (const p of players) {
    assert.equal(typeof p.id, 'string');
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.team, 'string');
    assert.equal(typeof p.overallRank, 'number');
    assert.equal(typeof p.positionRank, 'number');
    assert.equal(typeof p.projectedPoints, 'number');
    assert.ok(p.adp === null || typeof p.adp === 'number');
    assert.ok(p.bye === null || typeof p.bye === 'number');
  }

  const ranks = players.map((p) => p.overallRank).sort((a, b) => a - b);
  assert.deepEqual(ranks, players.map((_, i) => i + 1), 'overallRank must be dense 1..N');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/players-data.test.js`
Expected: FAIL — `Cannot find module '../scripts/fetch-players.mjs'`.

- [ ] **Step 4: Write `scripts/fetch-players.mjs`**

```js
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) fantasy-football-draft/1.0';

const ESPN_PLAYERS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/1?view=kona_player_info`;
const ESPN_TEAMS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`;
const FFC_ADP = `https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=10&year=${SEASON}&position=all`;

const ESPN_FILTER = JSON.stringify({
  players: {
    filterStatsForExternalIds: { value: [SEASON] },
    limit: 400,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
  },
});

const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

// Suffixes stripped so "Marvin Harrison Jr." matches FFC's "Marvin Harrison".
const NAME_SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(NAME_SUFFIXES, '')
    .replace(/[^a-z]/g, '');
}

function projectedPoints(player) {
  const stats = player.stats || [];
  const season = stats.find(
    (s) => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 0,
  );
  return season ? Math.round(season.appliedTotal * 10) / 10 : 0;
}

export function mergePlayers(espnJson, teamsJson, ffcJson) {
  const teamsById = new Map();
  for (const t of teamsJson.settings.proTeams) {
    teamsById.set(t.id, { abbrev: t.abbrev, bye: t.byeWeek ?? null });
  }

  // FFC lookups: skill players by normalized name, defenses by team abbrev.
  const adpByName = new Map();
  const adpByDefTeam = new Map();
  for (const p of ffcJson.players || []) {
    const position = p.position === 'PK' ? 'K' : p.position;
    if (position === 'DEF') adpByDefTeam.set(p.team, p.adp);
    else adpByName.set(normalizeName(p.name), p.adp);
  }

  const merged = [];
  for (const entry of espnJson.players) {
    const p = entry.player;
    const position = POSITION_BY_ID[p.defaultPositionId];
    if (!position) continue;

    const team = teamsById.get(p.proTeamId);
    const abbrev = team ? team.abbrev : 'FA';
    const isDef = position === 'DEF';

    merged.push({
      id: isDef ? `DEF-${abbrev}` : String(p.id),
      name: p.fullName,
      team: abbrev,
      position,
      espnRank: p.draftRanksByRankType?.STANDARD?.rank ?? 9999,
      projectedPoints: projectedPoints(p),
      adp: (isDef ? adpByDefTeam.get(abbrev) : adpByName.get(normalizeName(p.fullName))) ?? null,
      bye: team ? team.bye : null,
    });
  }

  // Dense 1..N overall rank in ESPN standard-rank order, then per-position rank.
  merged.sort((a, b) => a.espnRank - b.espnRank || b.projectedPoints - a.projectedPoints);
  const positionCounters = {};
  return merged.map((p, i) => {
    positionCounters[p.position] = (positionCounters[p.position] || 0) + 1;
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      position: p.position,
      overallRank: i + 1,
      positionRank: positionCounters[p.position],
      projectedPoints: p.projectedPoints,
      adp: p.adp,
      bye: p.bye,
    };
  });
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log('Fetching ESPN players...');
  const espn = await getJson(ESPN_PLAYERS, { 'x-fantasy-filter': ESPN_FILTER });
  console.log('Fetching ESPN pro teams...');
  const teams = await getJson(ESPN_TEAMS);
  console.log('Fetching FFC ADP...');
  const ffc = await getJson(FFC_ADP);

  const players = mergePlayers(espn, teams, ffc);
  const withAdp = players.filter((p) => p.adp !== null).length;

  const out = fileURLToPath(new URL('../data/players.json', import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(players, null, 0) + '\n');

  console.log(`Wrote ${players.length} players to data/players.json (${withAdp} with ADP)`);
  console.log(`FFC sample: ${ffc.meta.total_drafts} drafts, ${ffc.meta.start_date}..${ffc.meta.end_date}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Generate the data and run the tests**

Run:
```bash
node scripts/fetch-players.mjs
node --test tests/players-data.test.js
```
Expected: script prints `Wrote 300 players to data/players.json (~215 with ADP)`, then all 4 tests PASS.

If the ESPN endpoint returns fewer than 200 players, re-check the `x-fantasy-filter` header is being sent — without it ESPN caps the response at 50.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore scripts/fetch-players.mjs data/players.json tests/players-data.test.js
git commit -m "feat: fetch and merge 2026 ESPN projections with FFC ADP into player pool"
```

---

## Task 2: Snake draft order math

**Files:**
- Create: `src/core/snake.js`
- Test: `tests/snake.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pickToSlot(overallPick, numTeams) → { round: number, teamIndex: number }` — both 1-based.
  - `slotToPick(round, teamIndex, numTeams) → number` — 1-based overall pick.
  - `totalPicks(numTeams, rounds) → number`
  - `teamPicks(teamIndex, numTeams, rounds) → number[]` — all overall picks for a team, ascending.
  - `nextPickForTeam(afterPick, teamIndex, numTeams, rounds) → number | null` — first overall pick strictly greater than `afterPick` belonging to `teamIndex`.

- [ ] **Step 1: Write the failing test**

Create `tests/snake.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickToSlot, slotToPick, totalPicks, teamPicks, nextPickForTeam,
} from '../src/core/snake.js';

test('round 1 runs 1..N left to right', () => {
  assert.deepEqual(pickToSlot(1, 10), { round: 1, teamIndex: 1 });
  assert.deepEqual(pickToSlot(4, 10), { round: 1, teamIndex: 4 });
  assert.deepEqual(pickToSlot(10, 10), { round: 1, teamIndex: 10 });
});

test('round 2 reverses', () => {
  assert.deepEqual(pickToSlot(11, 10), { round: 2, teamIndex: 10 });
  assert.deepEqual(pickToSlot(17, 10), { round: 2, teamIndex: 4 });
  assert.deepEqual(pickToSlot(20, 10), { round: 2, teamIndex: 1 });
});

test('round 3 runs forward again', () => {
  assert.deepEqual(pickToSlot(21, 10), { round: 3, teamIndex: 1 });
  assert.deepEqual(pickToSlot(24, 10), { round: 3, teamIndex: 4 });
});

test('slotToPick is the exact inverse of pickToSlot', () => {
  for (let pick = 1; pick <= 150; pick += 1) {
    const { round, teamIndex } = pickToSlot(pick, 10);
    assert.equal(slotToPick(round, teamIndex, 10), pick, `roundtrip failed at pick ${pick}`);
  }
});

test('totalPicks multiplies teams by rounds', () => {
  assert.equal(totalPicks(10, 15), 150);
});

test('teamPicks returns the snake pattern for pick 4 of 10', () => {
  const picks = teamPicks(4, 10, 4);
  assert.deepEqual(picks, [4, 17, 24, 37]);
});

test('teamPicks for pick 7 of 10 pairs up correctly', () => {
  assert.deepEqual(teamPicks(7, 10, 3), [7, 14, 27]);
});

test('nextPickForTeam finds the following pick or null at the end', () => {
  assert.equal(nextPickForTeam(4, 4, 10, 15), 17);
  assert.equal(nextPickForTeam(16, 4, 10, 15), 17);
  assert.equal(nextPickForTeam(17, 4, 10, 15), 24);
  assert.equal(nextPickForTeam(144, 4, 10, 15), null, 'no pick after the last one');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/snake.test.js`
Expected: FAIL — `Cannot find module '../src/core/snake.js'`.

- [ ] **Step 3: Write `src/core/snake.js`**

```js
// Snake draft order. Rounds, team indices, and overall picks are all 1-based.

export function pickToSlot(overallPick, numTeams) {
  const zero = overallPick - 1;
  const round = Math.floor(zero / numTeams) + 1;
  const indexInRound = zero % numTeams;
  // Odd rounds run 1..N, even rounds run N..1.
  const teamIndex = round % 2 === 1 ? indexInRound + 1 : numTeams - indexInRound;
  return { round, teamIndex };
}

export function slotToPick(round, teamIndex, numTeams) {
  const indexInRound = round % 2 === 1 ? teamIndex - 1 : numTeams - teamIndex;
  return (round - 1) * numTeams + indexInRound + 1;
}

export function totalPicks(numTeams, rounds) {
  return numTeams * rounds;
}

export function teamPicks(teamIndex, numTeams, rounds) {
  const picks = [];
  for (let round = 1; round <= rounds; round += 1) {
    picks.push(slotToPick(round, teamIndex, numTeams));
  }
  return picks.sort((a, b) => a - b);
}

export function nextPickForTeam(afterPick, teamIndex, numTeams, rounds) {
  const picks = teamPicks(teamIndex, numTeams, rounds);
  for (const pick of picks) {
    if (pick > afterPick) return pick;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/snake.test.js`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/snake.js tests/snake.test.js
git commit -m "feat: add snake draft order math"
```

---

## Task 3: Roster slots and positional need tiers

**Files:**
- Create: `src/core/roster.js`
- Test: `tests/roster.test.js`

**Interfaces:**
- Consumes: player objects from Task 1 (`{ id, name, team, position, projectedPoints, ... }`).
- Produces:
  - `DEFAULT_SLOTS` — `{ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 }`
  - `FLEX_POSITIONS` — `['RB', 'WR', 'TE']`
  - `SKILL_POSITIONS` — `['QB', 'RB', 'WR', 'TE']`
  - `slotLabels(slots) → string[]` — e.g. `['QB','RB1','RB2','WR1','WR2','TE','FLEX','K','DEF','BN1'..'BN6']`
  - `assignSlots(players, slots) → Array<{ label: string, accepts: string[], player: Player|null }>` — same length and order as `slotLabels`.
  - `countByPosition(players) → { QB: n, RB: n, WR: n, TE: n, K: n, DEF: n }` — always all six keys.
  - `positionalNeeds(players, slots, round, totalRounds) → { QB: tier, RB: tier, WR: tier, TE: tier, K: tier, DEF: tier }` where tier is `'high' | 'medium' | 'low' | 'none'`.
  - `NEED_TIERS` — `['high', 'medium', 'low', 'none']`

- [ ] **Step 1: Write the failing test**

Create `tests/roster.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLOTS, slotLabels, assignSlots, countByPosition, positionalNeeds,
} from '../src/core/roster.js';

const p = (id, position, projectedPoints) => ({
  id, name: `P${id}`, team: 'XX', position, projectedPoints,
  overallRank: 1, positionRank: 1, adp: null, bye: null,
});

test('slotLabels enumerates starters then bench', () => {
  assert.deepEqual(slotLabels(DEFAULT_SLOTS), [
    'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6',
  ]);
});

test('assignSlots returns every slot with nulls when the roster is empty', () => {
  const assigned = assignSlots([], DEFAULT_SLOTS);
  assert.equal(assigned.length, 15);
  assert.ok(assigned.every((s) => s.player === null));
  assert.deepEqual(assigned[6], { label: 'FLEX', accepts: ['RB', 'WR', 'TE'], player: null });
});

test('assignSlots fills dedicated slots best-first before FLEX', () => {
  const players = [p('a', 'RB', 100), p('b', 'RB', 200), p('c', 'RB', 150)];
  const assigned = assignSlots(players, DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));

  assert.equal(byLabel.RB1, 'b', 'highest projection takes RB1');
  assert.equal(byLabel.RB2, 'c');
  assert.equal(byLabel.FLEX, 'a', 'third RB spills to FLEX');
  assert.equal(byLabel.BN1, null);
});

test('assignSlots overflows to bench once starters and FLEX are full', () => {
  const players = [
    p('a', 'RB', 100), p('b', 'RB', 200), p('c', 'RB', 150), p('d', 'RB', 90),
  ];
  const assigned = assignSlots(players, DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));
  assert.equal(byLabel.FLEX, 'a');
  assert.equal(byLabel.BN1, 'd');
});

test('assignSlots never puts a K or DEF in FLEX', () => {
  const assigned = assignSlots([p('k', 'K', 140), p('d', 'DEF', 130)], DEFAULT_SLOTS);
  const byLabel = Object.fromEntries(assigned.map((s) => [s.label, s.player && s.player.id]));
  assert.equal(byLabel.K, 'k');
  assert.equal(byLabel.DEF, 'd');
  assert.equal(byLabel.FLEX, null);
});

test('countByPosition always returns all six positions', () => {
  assert.deepEqual(countByPosition([p('a', 'RB', 1), p('b', 'RB', 1), p('c', 'WR', 1)]), {
    QB: 0, RB: 2, WR: 1, TE: 0, K: 0, DEF: 0,
  });
});

test('empty roster in round 1 makes every starting position high need', () => {
  const needs = positionalNeeds([], DEFAULT_SLOTS, 1, 15);
  assert.equal(needs.QB, 'high');
  assert.equal(needs.RB, 'high');
  assert.equal(needs.WR, 'high');
  assert.equal(needs.TE, 'high');
});

test('one RB makes RB medium — the second starter is still open', () => {
  const needs = positionalNeeds([p('a', 'RB', 200)], DEFAULT_SLOTS, 2, 15);
  assert.equal(needs.RB, 'medium');
  assert.equal(needs.WR, 'high');
});

test('starters full drops a position to low while FLEX or bench remains', () => {
  const roster = [p('a', 'RB', 200), p('b', 'RB', 190)];
  const needs = positionalNeeds(roster, DEFAULT_SLOTS, 3, 15);
  assert.equal(needs.RB, 'low');
});

test('K and DEF are none until the last three rounds', () => {
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 12, 15).K, 'none');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 12, 15).DEF, 'none');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 13, 15).K, 'high');
  assert.equal(positionalNeeds([], DEFAULT_SLOTS, 13, 15).DEF, 'high');
});

test('an already-drafted K goes back to none even late', () => {
  assert.equal(positionalNeeds([p('k', 'K', 140)], DEFAULT_SLOTS, 14, 15).K, 'none');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/roster.test.js`
Expected: FAIL — `Cannot find module '../src/core/roster.js'`.

- [ ] **Step 3: Write `src/core/roster.js`**

```js
export const DEFAULT_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 };
export const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const NEED_TIERS = ['high', 'medium', 'low', 'none'];

// K/DEF stay deprioritized until this many rounds remain (spec: rounds 13-14 of 15).
export const LATE_ROUND_WINDOW = 3;

const STARTER_ORDER = ['QB', 'RB', 'WR', 'TE'];

export function slotLabels(slots) {
  const labels = [];
  for (const pos of STARTER_ORDER) {
    const count = slots[pos] || 0;
    for (let i = 1; i <= count; i += 1) labels.push(count === 1 ? pos : `${pos}${i}`);
  }
  for (let i = 1; i <= (slots.FLEX || 0); i += 1) labels.push(slots.FLEX === 1 ? 'FLEX' : `FLEX${i}`);
  for (const pos of ['K', 'DEF']) {
    const count = slots[pos] || 0;
    for (let i = 1; i <= count; i += 1) labels.push(count === 1 ? pos : `${pos}${i}`);
  }
  for (let i = 1; i <= (slots.BENCH || 0); i += 1) labels.push(`BN${i}`);
  return labels;
}

function slotAccepts(label, slots) {
  if (label.startsWith('BN')) return ALL_POSITIONS;
  if (label.startsWith('FLEX')) return FLEX_POSITIONS;
  return [label.replace(/\d+$/, '')];
}

export function assignSlots(players, slots) {
  const labels = slotLabels(slots);
  const assigned = labels.map((label) => ({
    label,
    accepts: slotAccepts(label, slots),
    player: null,
  }));

  // Best projection first, so the strongest player claims the earliest matching slot.
  const remaining = [...players].sort((a, b) => b.projectedPoints - a.projectedPoints);

  // Three passes, narrowest slots first: dedicated position slots, then FLEX, then bench.
  const passes = [
    (s) => !s.label.startsWith('BN') && !s.label.startsWith('FLEX'),
    (s) => s.label.startsWith('FLEX'),
    (s) => s.label.startsWith('BN'),
  ];

  for (const matchesPass of passes) {
    for (const slot of assigned) {
      if (!matchesPass(slot) || slot.player) continue;
      const idx = remaining.findIndex((pl) => slot.accepts.includes(pl.position));
      if (idx !== -1) slot.player = remaining.splice(idx, 1)[0];
    }
  }

  return assigned;
}

export function countByPosition(players) {
  const counts = {};
  for (const pos of ALL_POSITIONS) counts[pos] = 0;
  for (const pl of players) {
    if (counts[pl.position] !== undefined) counts[pl.position] += 1;
  }
  return counts;
}

export function positionalNeeds(players, slots, round, totalRounds) {
  const counts = countByPosition(players);
  const needs = {};

  for (const pos of SKILL_POSITIONS) {
    const required = slots[pos] || 0;
    const have = counts[pos];
    if (required === 0) needs[pos] = 'low';
    else if (have === 0) needs[pos] = 'high';
    else if (have < required) needs[pos] = 'medium';
    else needs[pos] = 'low';
  }

  const lateRounds = round > totalRounds - LATE_ROUND_WINDOW;
  for (const pos of ['K', 'DEF']) {
    const required = slots[pos] || 0;
    if (counts[pos] >= required) needs[pos] = 'none';
    else needs[pos] = lateRounds ? 'high' : 'none';
  }

  return needs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/roster.test.js`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/roster.js tests/roster.test.js
git commit -m "feat: add roster slot assignment and positional need tiers"
```

---

## Task 4: Value-based drafting (VBD)

**Files:**
- Create: `src/core/vbd.js`
- Test: `tests/vbd.test.js`

**Interfaces:**
- Consumes: `DEFAULT_SLOTS` shape from `src/core/roster.js`; player objects from Task 1.
- Produces:
  - `FLEX_SHARE` — `{ RB: 0.4, WR: 0.4, TE: 0.2 }` (sums to 1.0; how one FLEX slot per team is split across positions).
  - `QB_DEPTH_FACTOR` — `1.2` (teams roster a backup QB, so replacement sits past QB10).
  - `baselineRanks(numTeams, slots) → { QB, RB, WR, TE, K, DEF }` — integer positional rank of the replacement-level player.
  - `replacementPoints(allPlayers, numTeams, slots) → { QB, RB, WR, TE, K, DEF }` — projected points at each baseline rank.
  - `withVbd(allPlayers, replacement) → Player[]` — every player copied with an added `vbd: number`.

  With league defaults (10 teams) this yields QB12, RB24, WR24, TE12, K10, DEF10 — matching the spec's stated examples.

- [ ] **Step 1: Write the failing test**

Create `tests/vbd.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineRanks, replacementPoints, withVbd } from '../src/core/vbd.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (position, positionRank, projectedPoints) => ({
  id: `${position}${positionRank}`, name: `${position}${positionRank}`, team: 'XX',
  position, positionRank, overallRank: positionRank, projectedPoints, adp: null, bye: null,
});

test('baseline ranks match the spec examples for a 10-team league', () => {
  const baselines = baselineRanks(10, DEFAULT_SLOTS);
  assert.equal(baselines.QB, 12, 'QB12 per spec');
  assert.equal(baselines.RB, 24, 'RB24 per spec: 10 * (2 + 0.4 flex)');
  assert.equal(baselines.WR, 24);
  assert.equal(baselines.TE, 12);
  assert.equal(baselines.K, 10);
  assert.equal(baselines.DEF, 10);
});

test('baseline ranks scale with league size', () => {
  const baselines = baselineRanks(12, DEFAULT_SLOTS);
  assert.equal(baselines.RB, 29, '12 * 2.4 = 28.8 rounds to 29');
  assert.equal(baselines.QB, 14, '12 * 1.2 = 14.4 floors to 14');
});

test('replacementPoints reads the player sitting at each baseline rank', () => {
  const pool = [];
  for (let i = 1; i <= 30; i += 1) pool.push(p('RB', i, 300 - i * 5));
  for (let i = 1; i <= 20; i += 1) pool.push(p('QB', i, 280 - i * 4));

  const replacement = replacementPoints(pool, 10, DEFAULT_SLOTS);
  assert.equal(replacement.RB, 300 - 24 * 5, 'RB24');
  assert.equal(replacement.QB, 280 - 12 * 4, 'QB12');
});

test('replacementPoints falls back to the worst player when the pool is shallow', () => {
  const pool = [p('TE', 1, 150), p('TE', 2, 120), p('TE', 3, 90)];
  const replacement = replacementPoints(pool, 10, DEFAULT_SLOTS);
  assert.equal(replacement.TE, 90, 'only 3 TEs exist, so TE3 is the floor');
});

test('replacementPoints is 0 for a position with no players', () => {
  const replacement = replacementPoints([p('RB', 1, 200)], 10, DEFAULT_SLOTS);
  assert.equal(replacement.WR, 0);
});

test('withVbd subtracts the positional replacement, not a global one', () => {
  const pool = [p('RB', 1, 300), p('QB', 1, 380)];
  const out = withVbd(pool, { QB: 300, RB: 120, WR: 0, TE: 0, K: 0, DEF: 0 });

  const rb = out.find((x) => x.position === 'RB');
  const qb = out.find((x) => x.position === 'QB');
  assert.equal(rb.vbd, 180);
  assert.equal(qb.vbd, 80, 'the higher-scoring QB has the lower VBD');
  assert.ok(rb.vbd > qb.vbd, 'VBD reorders across positions');
});

test('withVbd does not mutate the input players', () => {
  const pool = [p('RB', 1, 300)];
  withVbd(pool, { QB: 0, RB: 120, WR: 0, TE: 0, K: 0, DEF: 0 });
  assert.equal(pool[0].vbd, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/vbd.test.js`
Expected: FAIL — `Cannot find module '../src/core/vbd.js'`.

- [ ] **Step 3: Write `src/core/vbd.js`**

```js
import { ALL_POSITIONS } from './roster.js';

// One FLEX slot per team is split across RB/WR/TE by how often each actually fills it.
export const FLEX_SHARE = { RB: 0.4, WR: 0.4, TE: 0.2 };

// Teams carry a backup QB, so the QB replacement level sits past one-per-team.
export const QB_DEPTH_FACTOR = 1.2;

export function baselineRanks(numTeams, slots) {
  const flex = slots.FLEX || 0;
  const ranks = {};

  ranks.QB = Math.max(1, Math.floor(numTeams * (slots.QB || 0) * QB_DEPTH_FACTOR));
  for (const pos of ['RB', 'WR', 'TE']) {
    const perTeam = (slots[pos] || 0) + (FLEX_SHARE[pos] || 0) * flex;
    ranks[pos] = Math.max(1, Math.round(numTeams * perTeam));
  }
  for (const pos of ['K', 'DEF']) {
    ranks[pos] = Math.max(1, Math.round(numTeams * (slots[pos] || 0)));
  }

  return ranks;
}

export function replacementPoints(allPlayers, numTeams, slots) {
  const ranks = baselineRanks(numTeams, slots);
  const byPosition = {};
  for (const pos of ALL_POSITIONS) byPosition[pos] = [];
  for (const pl of allPlayers) {
    if (byPosition[pl.position]) byPosition[pl.position].push(pl);
  }

  const replacement = {};
  for (const pos of ALL_POSITIONS) {
    const sorted = byPosition[pos].sort((a, b) => b.projectedPoints - a.projectedPoints);
    if (sorted.length === 0) {
      replacement[pos] = 0;
      continue;
    }
    // Clamp to the shallowest available player when the pool is thinner than the baseline.
    const index = Math.min(ranks[pos], sorted.length) - 1;
    replacement[pos] = sorted[index].projectedPoints;
  }

  return replacement;
}

export function withVbd(allPlayers, replacement) {
  return allPlayers.map((pl) => ({
    ...pl,
    vbd: Math.round((pl.projectedPoints - (replacement[pl.position] || 0)) * 10) / 10,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/vbd.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/vbd.js tests/vbd.test.js
git commit -m "feat: add value-based drafting replacement levels and VBD scoring"
```

---

## Task 5: Composite recommendation engine

**Files:**
- Create: `src/core/recommend.js`
- Test: `tests/recommend.test.js`

**Interfaces:**
- Consumes: players carrying `vbd` from `withVbd()` (Task 4); need tiers from `positionalNeeds()` (Task 3).
- Produces:
  - `WEIGHTS` — `{ bpa: 0.6, vbd: 0.4 }`
  - `NEED_MULTIPLIER` — `{ high: 1.25, medium: 1.12, low: 1.0, none: 0.55 }`
  - `CLIFF_THRESHOLD` — `20` (projected-point gap that counts as a positional drop-off).
  - `scorePlayer(player, ctx) → number` where `ctx = { poolSize, maxAbsVbd, needs }`.
  - `reasonsFor(player, pool, ctx) → string[]` where `ctx = { needs, currentPick, nextPick, round }`.
  - `recommend(pool, ctx, limit = 3) → Array<{ player, score, need, reasons }>` where `ctx = { needs, currentPick, nextPick, round }`.

  `pool` is always the *available* players (with `vbd`), sorted or not — `recommend` sorts internally.

- [ ] **Step 1: Write the failing test**

Create `tests/recommend.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEED_MULTIPLIER, scorePlayer, reasonsFor, recommend,
} from '../src/core/recommend.js';

const p = (over) => ({
  id: over.id, name: over.id, team: 'XX',
  position: over.position, overallRank: over.overallRank,
  positionRank: over.positionRank ?? 1,
  projectedPoints: over.projectedPoints ?? 200,
  vbd: over.vbd ?? 50, adp: over.adp ?? null, bye: over.bye ?? null,
});

const allLow = { QB: 'low', RB: 'low', WR: 'low', TE: 'low', K: 'low', DEF: 'low' };

test('a better rank scores higher when need and VBD are equal', () => {
  const ctx = { poolSize: 100, maxAbsVbd: 100, needs: allLow };
  const good = scorePlayer(p({ id: 'a', position: 'RB', overallRank: 1 }), ctx);
  const worse = scorePlayer(p({ id: 'b', position: 'RB', overallRank: 50 }), ctx);
  assert.ok(good > worse);
});

test('a high-need multiplier beats a low-need one at equal value', () => {
  const base = { poolSize: 100, maxAbsVbd: 100 };
  const player = p({ id: 'a', position: 'RB', overallRank: 10 });
  const high = scorePlayer(player, { ...base, needs: { ...allLow, RB: 'high' } });
  const low = scorePlayer(player, { ...base, needs: allLow });
  assert.ok(high > low);
  assert.equal(Math.round((high / low) * 100) / 100, NEED_MULTIPLIER.high);
});

test('scores never go negative even at the bottom of the pool', () => {
  const ctx = { poolSize: 100, maxAbsVbd: 100, needs: allLow };
  const score = scorePlayer(p({ id: 'z', position: 'K', overallRank: 100, vbd: -100 }), ctx);
  assert.ok(score >= 0, `expected a non-negative score, got ${score}`);
});

test('need does not let a marginal player leapfrog a far better one', () => {
  const ctx = { needs: { ...allLow, TE: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const pool = [
    p({ id: 'elite-rb', position: 'RB', overallRank: 1, vbd: 120 }),
    p({ id: 'weak-te', position: 'TE', overallRank: 60, vbd: 5 }),
  ];
  const [top] = recommend(pool, ctx);
  assert.equal(top.player.id, 'elite-rb', 'need is a tiebreaker, not an override');
});

test('need breaks the tie when two players are close in value', () => {
  const ctx = { needs: { ...allLow, WR: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const pool = [
    p({ id: 'rb', position: 'RB', overallRank: 5, vbd: 80 }),
    p({ id: 'wr', position: 'WR', overallRank: 6, vbd: 78 }),
  ];
  const [top] = recommend(pool, ctx);
  assert.equal(top.player.id, 'wr');
});

test('recommend returns at most the requested number, best first', () => {
  const ctx = { needs: allLow, currentPick: 4, nextPick: 17, round: 1 };
  const pool = Array.from({ length: 10 }, (_, i) =>
    p({ id: `p${i}`, position: 'RB', overallRank: i + 1, vbd: 100 - i * 5 }));
  const out = recommend(pool, ctx, 3);
  assert.equal(out.length, 3);
  assert.ok(out[0].score >= out[1].score && out[1].score >= out[2].score);
  assert.equal(out[0].need, 'low');
  assert.ok(Array.isArray(out[0].reasons));
});

test('recommend on an empty pool returns an empty array', () => {
  assert.deepEqual(recommend([], { needs: allLow, currentPick: 1, nextPick: 2, round: 1 }), []);
});

test('reasonsFor flags a positional cliff', () => {
  const ctx = { needs: allLow, currentPick: 10, nextPick: 11, round: 1 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, projectedPoints: 280, vbd: 100 });
  const pool = [target, p({ id: 'b', position: 'RB', overallRank: 2, projectedPoints: 200, vbd: 20 })];
  const reasons = reasonsFor(target, pool, ctx);
  assert.ok(reasons.some((r) => /drop-off/i.test(r)), reasons.join(' | '));
  assert.ok(reasons.some((r) => /80/.test(r)), 'names the size of the gap');
});

test('reasonsFor states which need is filled', () => {
  const ctx = { needs: { ...allLow, RB: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, vbd: 100 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /high need/i.test(r)), reasons.join(' | '));
});

test('reasonsFor calls out a player falling past his ADP', () => {
  const ctx = { needs: allLow, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'WR', overallRank: 20, adp: 22, vbd: 60 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /past his ADP/i.test(r)), reasons.join(' | '));
});

test('reasonsFor warns when a pick is well ahead of ADP', () => {
  const ctx = { needs: allLow, currentPick: 10, nextPick: 11, round: 1 };
  const target = p({ id: 'a', position: 'WR', overallRank: 40, adp: 55, vbd: 10 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /reach/i.test(r)), reasons.join(' | '));
});

test('reasonsFor caps output at two lines', () => {
  const ctx = { needs: { ...allLow, RB: 'high' }, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, projectedPoints: 280, adp: 50, vbd: 120 });
  const pool = [target, p({ id: 'b', position: 'RB', overallRank: 2, projectedPoints: 150, vbd: 5 })];
  assert.ok(reasonsFor(target, pool, ctx).length <= 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/recommend.test.js`
Expected: FAIL — `Cannot find module '../src/core/recommend.js'`.

- [ ] **Step 3: Write `src/core/recommend.js`**

```js
// BPA rank sets the baseline ordering; VBD adjusts within tiers; need applies a
// multiplier small enough that it breaks ties without overriding real value gaps.
export const WEIGHTS = { bpa: 0.6, vbd: 0.4 };
export const NEED_MULTIPLIER = { high: 1.25, medium: 1.12, low: 1.0, none: 0.55 };

// A projected-point gap this large to the next player at the position is a cliff.
export const CLIFF_THRESHOLD = 20;

// Picks past ADP before we call a player a value, or ahead of ADP before we call it a reach.
export const ADP_VALUE_GAP = 8;
export const ADP_REACH_GAP = 12;

const NEED_LABEL = { high: 'high need', medium: 'medium need', low: 'depth', none: 'not needed' };

export function scorePlayer(player, ctx) {
  const { poolSize, maxAbsVbd, needs } = ctx;

  // Both components normalize into [0, 1] so the multiplier can never flip a sign.
  const bpaScore = Math.max(0, (poolSize - (player.overallRank - 1)) / poolSize);
  const scale = maxAbsVbd || 1;
  const clamped = Math.max(-1, Math.min(1, player.vbd / scale));
  const vbdScore = (clamped + 1) / 2;

  const value = WEIGHTS.bpa * bpaScore + WEIGHTS.vbd * vbdScore;
  const multiplier = NEED_MULTIPLIER[needs[player.position]] ?? 1;
  return value * multiplier;
}

function nextAtPosition(player, pool) {
  return pool
    .filter((x) => x.position === player.position && x.id !== player.id)
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .find((x) => x.projectedPoints <= player.projectedPoints) || null;
}

export function reasonsFor(player, pool, ctx) {
  const { needs, currentPick } = ctx;
  const reasons = [];

  const next = nextAtPosition(player, pool);
  if (next) {
    const gap = Math.round(player.projectedPoints - next.projectedPoints);
    if (gap >= CLIFF_THRESHOLD) {
      reasons.push(`Big drop-off at ${player.position} — next ${player.position} projects ${gap} pts lower`);
    }
  }

  const tier = needs[player.position];
  if (tier === 'high' || tier === 'medium') {
    reasons.push(`Fills your ${player.position} slot (${NEED_LABEL[tier]})`);
  }

  if (player.adp !== null && player.adp !== undefined) {
    const past = Math.round(currentPick - player.adp);
    if (past >= ADP_VALUE_GAP) {
      reasons.push(`Value — ${past} picks past his ADP of ${player.adp}`);
    } else if (-past >= ADP_REACH_GAP) {
      reasons.push(`Slight reach — ADP is ${player.adp}, ${-past} picks from now`);
    }
  }

  if (reasons.length === 0) {
    reasons.push(`Best value on the board (+${Math.round(player.vbd)} over replacement)`);
  }

  return reasons.slice(0, 2);
}

export function recommend(pool, ctx, limit = 3) {
  if (pool.length === 0) return [];

  const maxAbsVbd = pool.reduce((max, pl) => Math.max(max, Math.abs(pl.vbd)), 0);
  const scoreCtx = { poolSize: pool.length, maxAbsVbd, needs: ctx.needs };

  return pool
    .map((player) => ({ player, score: scorePlayer(player, scoreCtx) }))
    .sort((a, b) => b.score - a.score || a.player.overallRank - b.player.overallRank)
    .slice(0, limit)
    .map(({ player, score }) => ({
      player,
      score,
      need: ctx.needs[player.position],
      reasons: reasonsFor(player, pool, ctx),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/recommend.test.js`
Expected: 12 tests PASS.

- [ ] **Step 5: Sanity-check the engine against the real pool**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { withVbd, replacementPoints } from './src/core/vbd.js';
import { DEFAULT_SLOTS, positionalNeeds } from './src/core/roster.js';
import { recommend } from './src/core/recommend.js';
const players = JSON.parse(readFileSync('./data/players.json'));
const pool = withVbd(players, replacementPoints(players, 10, DEFAULT_SLOTS));
const needs = positionalNeeds([], DEFAULT_SLOTS, 1, 15);
for (const r of recommend(pool, { needs, currentPick: 4, nextPick: 17, round: 1 }, 3)) {
  console.log(r.player.overallRank, r.player.name, r.player.position, 'vbd', r.player.vbd, '|', r.reasons.join(' / '));
}
"
```
Expected: three top-20 skill players (RB/WR), each with a readable reason line. If a kicker or defense appears in the top 3, the need multiplier is wired wrong — `positionalNeeds` returns `'none'` for K/DEF in round 1 and `NEED_MULTIPLIER.none` is `0.55`.

- [ ] **Step 6: Commit**

```bash
git add src/core/recommend.js tests/recommend.test.js
git commit -m "feat: add composite BPA/need/VBD recommendation engine"
```

---

## Task 6: Competitive awareness

**Files:**
- Create: `src/core/competitive.js`
- Test: `tests/competitive.test.js`

**Interfaces:**
- Consumes: `pickToSlot` from `src/core/snake.js`; `positionalNeeds` from `src/core/roster.js`.
- Produces:
  - `teamsPickingBetween(currentPick, nextPick, numTeams) → number[]` — team indices for picks strictly between the two, in pick order, with duplicates preserved.
  - `needCountsBetween(args) → { RB: n, WR: n, ... }` where `args = { currentPick, nextPick, numTeams, rounds, rostersByTeam, slots }`. Counts how many of the intervening picks belong to teams with a `high` or `medium` need at each position.
  - `competitiveNotes(args) → string[]` where `args = { currentPick, nextPick, numTeams, rounds, rostersByTeam, slots, pool, replacement }`. Returns at most 3 advisory strings.
  - `RUN_RISK_THRESHOLD` — `2` (minimum intervening teams needing a position before it is worth a note).

- [ ] **Step 1: Write the failing test**

Create `tests/competitive.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamsPickingBetween, needCountsBetween, competitiveNotes } from '../src/core/competitive.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (id, position, projectedPoints) => ({
  id, name: id, team: 'XX', position, projectedPoints,
  overallRank: 1, positionRank: 1, adp: null, bye: null, vbd: projectedPoints - 100,
});

test('teamsPickingBetween walks the snake turn between two of my picks', () => {
  // Picking 4th of 10: my picks are 4 and 17. Between them: 5..16.
  assert.deepEqual(teamsPickingBetween(4, 17, 10), [5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5]);
});

test('teamsPickingBetween is empty for back-to-back picks', () => {
  assert.deepEqual(teamsPickingBetween(10, 11, 10), []);
});

test('teamsPickingBetween handles a null next pick', () => {
  assert.deepEqual(teamsPickingBetween(144, null, 10), []);
});

test('needCountsBetween counts picks by teams that need each position', () => {
  const rostersByTeam = {
    5: [p('a', 'RB', 200), p('b', 'RB', 190)], // RB starters full -> low
    6: [],                                     // needs everything -> high
    7: [],
  };
  const counts = needCountsBetween({
    currentPick: 4, nextPick: 8, numTeams: 10, rounds: 15, rostersByTeam, slots: DEFAULT_SLOTS,
  });
  assert.equal(counts.RB, 2, 'teams 6 and 7 need RB; team 5 does not');
  assert.equal(counts.WR, 3, 'all three still need WR');
});

test('needCountsBetween treats a team with no roster entry as needing everything', () => {
  const counts = needCountsBetween({
    currentPick: 4, nextPick: 7, numTeams: 10, rounds: 15, rostersByTeam: {}, slots: DEFAULT_SLOTS,
  });
  assert.equal(counts.RB, 2);
  assert.equal(counts.TE, 2);
});

test('competitiveNotes warns when demand for a thin position exceeds supply', () => {
  const pool = [p('rb1', 'RB', 260), p('rb2', 'RB', 250)]; // only 2 RBs above replacement
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 0, RB: 150, WR: 150, TE: 0, K: 0, DEF: 0 },
  });
  assert.ok(notes.length > 0);
  assert.ok(/RB/.test(notes[0]), notes.join(' | '));
  assert.ok(/12 teams? pick/i.test(notes[0]) || /12 of/.test(notes[0]), notes[0]);
});

test('competitiveNotes stays quiet when supply comfortably exceeds demand', () => {
  const pool = Array.from({ length: 40 }, (_, i) => p(`rb${i}`, 'RB', 300 - i));
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 0, RB: 150, WR: 150, TE: 0, K: 0, DEF: 0 },
  });
  assert.ok(!notes.some((n) => /^RB/.test(n)), notes.join(' | '));
});

test('competitiveNotes returns nothing for back-to-back picks', () => {
  const notes = competitiveNotes({
    currentPick: 10, nextPick: 11, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool: [p('rb1', 'RB', 260)],
    replacement: { RB: 150 },
  });
  assert.deepEqual(notes, []);
});

test('competitiveNotes caps at three notes', () => {
  const pool = [p('rb1', 'RB', 260), p('wr1', 'WR', 250), p('te1', 'TE', 240), p('qb1', 'QB', 300)];
  const notes = competitiveNotes({
    currentPick: 4, nextPick: 17, numTeams: 10, rounds: 15,
    rostersByTeam: {}, slots: DEFAULT_SLOTS, pool,
    replacement: { QB: 200, RB: 150, WR: 150, TE: 150, K: 0, DEF: 0 },
  });
  assert.ok(notes.length <= 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/competitive.test.js`
Expected: FAIL — `Cannot find module '../src/core/competitive.js'`.

- [ ] **Step 3: Write `src/core/competitive.js`**

```js
import { pickToSlot } from './snake.js';
import { positionalNeeds, SKILL_POSITIONS } from './roster.js';

export const RUN_RISK_THRESHOLD = 2;
const NOTE_POSITIONS = SKILL_POSITIONS;
const MAX_NOTES = 3;

export function teamsPickingBetween(currentPick, nextPick, numTeams) {
  if (!nextPick) return [];
  const teams = [];
  for (let pick = currentPick + 1; pick < nextPick; pick += 1) {
    teams.push(pickToSlot(pick, numTeams).teamIndex);
  }
  return teams;
}

export function needCountsBetween({ currentPick, nextPick, numTeams, rounds, rostersByTeam, slots }) {
  const counts = {};
  for (const pos of NOTE_POSITIONS) counts[pos] = 0;

  for (let pick = currentPick + 1; nextPick && pick < nextPick; pick += 1) {
    const { round, teamIndex } = pickToSlot(pick, numTeams);
    const roster = rostersByTeam[teamIndex] || [];
    const needs = positionalNeeds(roster, slots, round, rounds);
    for (const pos of NOTE_POSITIONS) {
      if (needs[pos] === 'high' || needs[pos] === 'medium') counts[pos] += 1;
    }
  }

  return counts;
}

export function competitiveNotes({
  currentPick, nextPick, numTeams, rounds, rostersByTeam, slots, pool, replacement,
}) {
  const between = teamsPickingBetween(currentPick, nextPick, numTeams);
  if (between.length === 0) return [];

  const counts = needCountsBetween({ currentPick, nextPick, numTeams, rounds, rostersByTeam, slots });

  const notes = [];
  for (const pos of NOTE_POSITIONS) {
    const demand = counts[pos];
    if (demand < RUN_RISK_THRESHOLD) continue;

    // Supply = players at this position still projecting above replacement level.
    const supply = pool.filter(
      (pl) => pl.position === pos && pl.projectedPoints > (replacement[pos] || 0),
    ).length;
    if (supply === 0 || supply > demand) continue;

    notes.push(
      `${pos}: ${demand} of the ${between.length} picks before your next need ${pos}, ` +
      `and only ${supply} starter-grade ${pos}${supply === 1 ? '' : 's'} remain — consider taking one now`,
    );
  }

  return notes
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_NOTES);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/competitive.test.js`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/competitive.js tests/competitive.test.js
git commit -m "feat: add competitive awareness for positional runs between picks"
```

---

## Task 7: Draft state, keepers, undo, and persistence

**Files:**
- Create: `src/core/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `pickToSlot`, `slotToPick`, `totalPicks`, `nextPickForTeam` from `src/core/snake.js`; `DEFAULT_SLOTS` from `src/core/roster.js`.
- Produces:
  - `STORAGE_KEY` — `'ffdraft.state.v1'`
  - `DEFAULT_CONFIG` — `{ numTeams: 10, rounds: 15, scoring: 'standard', draftType: 'snake', myTeamIndex: 4, slots: DEFAULT_SLOTS, teams: [...] }` with `teams[i] = { name: 'Team N', keeper: null }`.
  - `createState(config) → State` — `{ config, picks: {}, history: [] }`, keepers already placed.
  - `currentPickNumber(state) → number | null` — lowest unfilled overall pick, or `null` when the draft is complete.
  - `applyPick(state, playerId) → State` — new state with the player at the current pick. Throws on a duplicate player or a finished draft.
  - `undoPick(state) → State` — reverses the most recent non-keeper pick. No-op when history is empty.
  - `pickedIds(state) → Set<string>`
  - `availablePlayers(state, allPlayers) → Player[]`
  - `rosterFor(state, teamIndex, allPlayers) → Player[]` — in pick order.
  - `rostersByTeam(state, allPlayers) → { [teamIndex]: Player[] }` — every team index present.
  - `myNextPick(state) → number | null`
  - `serialize(state) → string`, `deserialize(json) → State`
  - `saveState(state, storage)`, `loadState(storage) → State | null`, `clearState(storage)` — `storage` defaults to `globalThis.localStorage` and is injectable for tests.

- [ ] **Step 1: Write the failing test**

Create `tests/state.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, DEFAULT_CONFIG, createState, currentPickNumber, applyPick, undoPick,
  availablePlayers, rosterFor, rostersByTeam, myNextPick, saveState, loadState, clearState,
} from '../src/core/state.js';

const PLAYERS = Array.from({ length: 200 }, (_, i) => ({
  id: `p${i + 1}`, name: `Player ${i + 1}`, team: 'XX',
  position: ['RB', 'WR', 'QB', 'TE'][i % 4],
  overallRank: i + 1, positionRank: Math.floor(i / 4) + 1,
  projectedPoints: 300 - i, adp: i + 1, bye: 7,
}));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('a fresh draft starts at pick 1 with nothing taken', () => {
  const state = createState(DEFAULT_CONFIG);
  assert.equal(currentPickNumber(state), 1);
  assert.equal(availablePlayers(state, PLAYERS).length, 200);
});

test('applyPick advances the pick and assigns to the right team', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  assert.equal(currentPickNumber(state), 2);
  assert.deepEqual(state.picks[1], { playerId: 'p1', teamIndex: 1, isKeeper: false });
  assert.equal(availablePlayers(state, PLAYERS).length, 199);
});

test('applyPick does not mutate the previous state', () => {
  const before = createState(DEFAULT_CONFIG);
  applyPick(before, 'p1');
  assert.equal(currentPickNumber(before), 1);
});

test('applyPick rejects a player who is already drafted', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  assert.throws(() => applyPick(state, 'p1'), /already drafted/i);
});

test('picks follow the snake into round 2', () => {
  let state = createState(DEFAULT_CONFIG);
  for (let i = 1; i <= 11; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(state.picks[10].teamIndex, 10);
  assert.equal(state.picks[11].teamIndex, 10, 'team 10 picks back-to-back at the turn');
});

test('undoPick reverses the last pick and returns the player to the pool', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  state = applyPick(state, 'p2');
  state = undoPick(state);
  assert.equal(currentPickNumber(state), 2);
  assert.equal(state.picks[2], undefined);
  assert.ok(availablePlayers(state, PLAYERS).some((pl) => pl.id === 'p2'));
});

test('undoPick on an untouched draft is a no-op', () => {
  const state = createState(DEFAULT_CONFIG);
  assert.equal(currentPickNumber(undoPick(state)), 1);
});

test('keepers are pre-placed and their pick slot is skipped', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 0 ? { ...t, keeper: { playerId: 'p5', round: 1 } } : t)),
  };
  const state = createState(config);

  assert.deepEqual(state.picks[1], { playerId: 'p5', teamIndex: 1, isKeeper: true });
  assert.equal(currentPickNumber(state), 2, 'the keeper slot is already filled');
  assert.ok(!availablePlayers(state, PLAYERS).some((pl) => pl.id === 'p5'));
});

test('a round-3 keeper is placed at that team\'s round-3 slot', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 6 ? { ...t, keeper: { playerId: 'p9', round: 3 } } : t)),
  };
  const state = createState(config);
  // Team 7, round 3 (odd, runs forward) = pick 27.
  assert.deepEqual(state.picks[27], { playerId: 'p9', teamIndex: 7, isKeeper: true });
});

test('undoPick never removes a keeper', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 0 ? { ...t, keeper: { playerId: 'p5', round: 1 } } : t)),
  };
  let state = createState(config);
  state = applyPick(state, 'p1');
  state = undoPick(state);
  state = undoPick(state);
  assert.deepEqual(state.picks[1], { playerId: 'p5', teamIndex: 1, isKeeper: true });
});

test('rosterFor and rostersByTeam group players by team', () => {
  let state = createState(DEFAULT_CONFIG);
  for (let i = 1; i <= 12; i += 1) state = applyPick(state, `p${i}`);

  assert.deepEqual(rosterFor(state, 1, PLAYERS).map((pl) => pl.id), ['p1']);
  assert.deepEqual(rosterFor(state, 10, PLAYERS).map((pl) => pl.id), ['p10', 'p11']);

  const all = rostersByTeam(state, PLAYERS);
  assert.equal(Object.keys(all).length, 10, 'every team index is present');
  assert.deepEqual(all[9].map((pl) => pl.id), ['p9', 'p12']);
});

test('myNextPick tracks the user\'s upcoming turn', () => {
  let state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4 });
  assert.equal(myNextPick(state), 4);
  for (let i = 1; i <= 4; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(myNextPick(state), 17);
});

test('currentPickNumber is null once every pick is filled', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 1 });
  for (let i = 1; i <= 10; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(currentPickNumber(state), null);
  assert.throws(() => applyPick(state, 'p11'), /complete/i);
});

test('state round-trips through storage', () => {
  const storage = memoryStorage();
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  saveState(state, storage);

  const loaded = loadState(storage);
  assert.deepEqual(loaded.picks, state.picks);
  assert.deepEqual(loaded.history, state.history);
  assert.equal(loaded.config.myTeamIndex, state.config.myTeamIndex);

  clearState(storage);
  assert.equal(loadState(storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('loadState returns null on corrupt storage instead of throwing', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, 'not json{');
  assert.equal(loadState(storage), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — `Cannot find module '../src/core/state.js'`.

- [ ] **Step 3: Write `src/core/state.js`**

```js
import { pickToSlot, slotToPick, totalPicks, nextPickForTeam } from './snake.js';
import { DEFAULT_SLOTS } from './roster.js';

export const STORAGE_KEY = 'ffdraft.state.v1';

function defaultTeams(numTeams) {
  return Array.from({ length: numTeams }, (_, i) => ({ name: `Team ${i + 1}`, keeper: null }));
}

export const DEFAULT_CONFIG = {
  numTeams: 10,
  rounds: 15,
  scoring: 'standard',
  draftType: 'snake',
  myTeamIndex: 4,
  slots: { ...DEFAULT_SLOTS },
  teams: defaultTeams(10),
};

export function createState(config) {
  const full = { ...DEFAULT_CONFIG, ...config };
  full.slots = { ...DEFAULT_SLOTS, ...(config.slots || {}) };
  full.teams = config.teams && config.teams.length === full.numTeams
    ? config.teams.map((t) => ({ name: t.name, keeper: t.keeper || null }))
    : defaultTeams(full.numTeams);

  const picks = {};
  full.teams.forEach((team, i) => {
    if (!team.keeper || !team.keeper.playerId) return;
    const teamIndex = i + 1;
    const round = Number(team.keeper.round) || 1;
    const pick = slotToPick(round, teamIndex, full.numTeams);
    picks[pick] = { playerId: String(team.keeper.playerId), teamIndex, isKeeper: true };
  });

  return { config: full, picks, history: [] };
}

export function currentPickNumber(state) {
  const last = totalPicks(state.config.numTeams, state.config.rounds);
  for (let pick = 1; pick <= last; pick += 1) {
    if (!state.picks[pick]) return pick;
  }
  return null;
}

export function pickedIds(state) {
  return new Set(Object.values(state.picks).map((entry) => entry.playerId));
}

export function applyPick(state, playerId) {
  const pick = currentPickNumber(state);
  if (pick === null) throw new Error('Draft is complete — no picks remain');
  if (pickedIds(state).has(String(playerId))) {
    throw new Error(`Player ${playerId} is already drafted`);
  }

  const { teamIndex } = pickToSlot(pick, state.config.numTeams);
  return {
    ...state,
    picks: { ...state.picks, [pick]: { playerId: String(playerId), teamIndex, isKeeper: false } },
    history: [...state.history, pick],
  };
}

export function undoPick(state) {
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const pick = history.pop();
  const picks = { ...state.picks };
  delete picks[pick];
  return { ...state, picks, history };
}

export function availablePlayers(state, allPlayers) {
  const taken = pickedIds(state);
  return allPlayers.filter((pl) => !taken.has(pl.id));
}

export function rosterFor(state, teamIndex, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  return Object.keys(state.picks)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((pick) => state.picks[pick].teamIndex === teamIndex)
    .map((pick) => byId.get(state.picks[pick].playerId))
    .filter(Boolean);
}

export function rostersByTeam(state, allPlayers) {
  const out = {};
  for (let i = 1; i <= state.config.numTeams; i += 1) out[i] = [];

  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  for (const pick of Object.keys(state.picks).map(Number).sort((a, b) => a - b)) {
    const entry = state.picks[pick];
    const player = byId.get(entry.playerId);
    if (player && out[entry.teamIndex]) out[entry.teamIndex].push(player);
  }
  return out;
}

export function myNextPick(state) {
  const pick = currentPickNumber(state);
  const { numTeams, rounds, myTeamIndex } = state.config;
  if (pick === null) return null;
  if (pickToSlot(pick, numTeams).teamIndex === myTeamIndex) return pick;
  return nextPickForTeam(pick - 1, myTeamIndex, numTeams, rounds);
}

export function serialize(state) {
  return JSON.stringify({ version: 1, ...state });
}

export function deserialize(json) {
  const raw = JSON.parse(json);
  if (!raw || !raw.config || !raw.picks) throw new Error('Malformed draft state');
  return { config: raw.config, picks: raw.picks, history: raw.history || [] };
}

function resolveStorage(storage) {
  return storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
}

export function saveState(state, storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  store.setItem(STORAGE_KEY, serialize(state));
}

export function loadState(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clearState(storage) {
  const store = resolveStorage(storage);
  if (store) store.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/state.test.js`
Expected: 15 tests PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test tests/`
Expected: all tests across all files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/state.js tests/state.test.js
git commit -m "feat: add draft state with keepers, undo, and localStorage persistence"
```

---

## Task 8: Build script, page shell, and styles

**Files:**
- Create: `scripts/build.mjs`
- Create: `src/index.html`
- Create: `src/styles.css`
- Create: `src/ui/dom.js`
- Test: `tests/build.test.js`

**Interfaces:**
- Consumes: every module under `src/`, `src/styles.css`, `data/players.json`.
- Produces:
  - `scripts/build.mjs` exporting `transformModule(source, moduleKey)` and `bundle({ srcDir, entry, players, css, html }) → string`.
  - `draft.html` at the repo root — one self-contained file.
  - `src/ui/dom.js` exporting:
    - `POSITION_COLORS` — `{ QB: '#ef4444', RB: '#3b82f6', WR: '#22c55e', TE: '#f97316', K: '#9ca3af', DEF: '#9ca3af' }`
    - `el(tag, attrs, children) → HTMLElement` — `attrs` may include `class`, `text`, `title`, `dataset`, `style`, and `on<Event>` handler functions.
    - `clear(node)` — remove all children.
    - `abbreviate(name) → string` — `'Jahmyr Gibbs'` → `'J. Gibbs'`, `'Seahawks D/ST'` → `'Seahawks'`.

- [ ] **Step 1: Write the failing test**

Create `tests/build.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { transformModule } from '../scripts/build.mjs';

test('transformModule rewrites a named import into a registry lookup', () => {
  const out = transformModule("import { pickToSlot, slotToPick } from './snake.js';\n", 'core/app.js');
  assert.match(out, /const \{ pickToSlot, slotToPick \} = __req\('core\/snake\.js'\)/);
  assert.doesNotMatch(out, /^import /m);
});

test('transformModule resolves parent-relative imports', () => {
  const out = transformModule("import { el } from '../ui/dom.js';\n", 'core/app.js');
  assert.match(out, /__req\('ui\/dom\.js'\)/);
});

test('transformModule converts exported functions, consts, and classes', () => {
  const out = transformModule(
    'export function go() { return 1; }\nexport const X = 2;\nexport class Y {}\n',
    'core/a.js',
  );
  assert.match(out, /^function go\(\)/m);
  assert.match(out, /^const X = 2;/m);
  assert.match(out, /^class Y \{\}/m);
  assert.match(out, /__exports\.go = go/);
  assert.match(out, /__exports\.X = X/);
  assert.match(out, /__exports\.Y = Y/);
  assert.doesNotMatch(out, /^export /m);
});

test('transformModule leaves non-export code alone', () => {
  const out = transformModule('const hidden = 5;\nfunction helper() {}\n', 'core/a.js');
  assert.match(out, /const hidden = 5;/);
  assert.doesNotMatch(out, /__exports\.hidden/);
});

test('built draft.html is self-contained and has no module syntax left', () => {
  const path = new URL('../draft.html', import.meta.url);
  assert.ok(existsSync(path), 'run `node scripts/build.mjs` first');
  const html = readFileSync(path, 'utf8');

  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+href=/i, 'no external stylesheets');
  assert.doesNotMatch(html, /\bfetch\s*\(/, 'no network access at runtime');
  assert.doesNotMatch(html, /^\s*import\s+\{/m, 'all imports were rewritten');
  assert.doesNotMatch(html, /^\s*export\s+(function|const|class)/m, 'all exports were rewritten');

  assert.match(html, /__PLAYERS__|window\.PLAYERS/, 'player data is inlined');
  assert.ok(html.length > 50_000, `expected a substantial bundle, got ${html.length} bytes`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/build.test.js`
Expected: FAIL — `Cannot find module '../scripts/build.mjs'`.

- [ ] **Step 3: Write `src/ui/dom.js`**

```js
export const POSITION_COLORS = {
  QB: '#ef4444',
  RB: '#3b82f6',
  WR: '#22c55e',
  TE: '#f97316',
  K: '#9ca3af',
  DEF: '#9ca3af',
};

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  const options = attrs || {};

  for (const [key, value] of Object.entries(options)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }

  for (const child of children || []) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function abbreviate(name) {
  const cleaned = String(name).replace(/\s+D\/ST$/, '');
  const parts = cleaned.split(' ');
  if (parts.length < 2) return cleaned;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export function formatPick(overallPick, numTeams) {
  const round = Math.floor((overallPick - 1) / numTeams) + 1;
  const inRound = ((overallPick - 1) % numTeams) + 1;
  return `${round}.${String(inRound).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Write `src/index.html` and `src/styles.css`**

`src/index.html` — the build template. `<!--STYLES-->`, `<!--DATA-->`, and `<!--SCRIPT-->` are replaced verbatim by the build:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft Assistant</title>
<style>/*<!--STYLES-->*/</style>
</head>
<body>
<div id="app"></div>
<script>/*<!--DATA-->*/</script>
<script>/*<!--SCRIPT-->*/</script>
</body>
</html>
```

`src/styles.css`:

```css
:root {
  --bg: #0f1116;
  --panel: #181b23;
  --panel-2: #1f232d;
  --border: #2a2f3a;
  --text: #e6e8ed;
  --muted: #8b93a5;
  --accent: #fbbf24;
  --qb: #ef4444;
  --rb: #3b82f6;
  --wr: #22c55e;
  --te: #f97316;
  --k: #9ca3af;
  --def: #9ca3af;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

button {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #1a1205; border-color: var(--accent); font-weight: 600; }

input, select {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
input:focus, select:focus { outline: 1px solid var(--accent); }

/* ---- Layout ---- */
.layout {
  display: grid;
  grid-template-columns: 260px minmax(420px, 1fr) minmax(520px, 1.1fr);
  gap: 12px;
  padding: 12px;
  height: 100vh;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  overflow: auto;
  min-height: 0;
}
.panel h2 {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ---- Setup ---- */
.setup { max-width: 900px; margin: 32px auto; padding: 24px; }
.setup h1 { margin-top: 0; }
.field-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; color: var(--muted); }
.pos-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.pos-btn { width: 40px; text-align: center; }
.pos-btn.selected { background: var(--accent); color: #1a1205; border-color: var(--accent); }
table.teams { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
table.teams th, table.teams td { padding: 4px 6px; border-bottom: 1px solid var(--border); text-align: left; }
table.teams th { font-size: 12px; color: var(--muted); font-weight: 500; }

/* ---- My team ---- */
.slot { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); }
.slot .label { color: var(--muted); font-size: 12px; width: 46px; flex: none; }
.slot .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot .name.empty { color: #4b5263; font-style: italic; }
.needs { margin-top: 14px; }
.need-row { display: flex; justify-content: space-between; padding: 3px 0; }
.tier { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.tier-high { color: #f87171; font-weight: 600; }
.tier-medium { color: var(--accent); }
.tier-low { color: var(--muted); }
.tier-none { color: #4b5263; }

/* ---- Center ---- */
.pickbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.pickbar input { flex: 1; }
.pick-info { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.pick-info .round { font-size: 20px; font-weight: 600; }
.pick-info .who { color: var(--muted); }
.pick-info .who.mine { color: var(--accent); font-weight: 600; }

.suggest { position: relative; }
.suggest-list {
  position: absolute; z-index: 20; left: 0; right: 0; top: 100%;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
  max-height: 260px; overflow: auto;
}
.suggest-list div { padding: 6px 8px; cursor: pointer; }
.suggest-list div.active, .suggest-list div:hover { background: #2b3140; }

.rec { border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: var(--panel-2); }
.rec .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.rec .pname { font-size: 16px; font-weight: 600; }
.rec .meta { color: var(--muted); font-size: 12px; }
.rec .why { color: #c3c9d6; font-size: 12px; margin-top: 4px; }
.notes { border: 1px solid #4a3a12; background: #241d08; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 12px; }

table.players { width: 100%; border-collapse: collapse; font-size: 13px; }
table.players th { position: sticky; top: 0; background: var(--panel); text-align: left; padding: 4px 6px; font-size: 11px; color: var(--muted); cursor: pointer; border-bottom: 1px solid var(--border); }
table.players td { padding: 3px 6px; border-bottom: 1px solid #22262f; }
table.players tr:hover td { background: #22262f; }
.filters { display: flex; gap: 6px; align-items: center; margin: 10px 0 6px; flex-wrap: wrap; }
.filters button.selected { background: var(--accent); color: #1a1205; }

/* ---- Board ---- */
table.board { border-collapse: collapse; font-size: 11px; width: 100%; table-layout: fixed; }
table.board th { padding: 4px 3px; border: 1px solid var(--border); color: var(--muted); font-weight: 500; cursor: pointer; }
table.board th.mine { color: var(--accent); }
table.board td { border: 1px solid var(--border); padding: 3px; height: 26px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
table.board td.mine-col { background: #1c2130; }
table.board td.current { outline: 2px solid var(--accent); outline-offset: -2px; animation: pulse 1.4s ease-in-out infinite; }
table.board td.keeper::after { content: "K"; float: right; font-size: 9px; color: var(--accent); font-weight: 700; }
table.board .rnd { color: var(--muted); text-align: center; width: 28px; }
@keyframes pulse { 0%, 100% { background: #2b2410; } 50% { background: #3a3016; } }

.roster-pop { position: fixed; z-index: 40; background: var(--panel-2); border: 1px solid var(--accent); border-radius: 8px; padding: 10px; max-width: 260px; font-size: 12px; }
```

- [ ] **Step 5: Write `scripts/build.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// Resolve './x.js' or '../ui/x.js' relative to the importing module's key.
function resolveKey(fromKey, spec) {
  const base = posix.dirname(fromKey);
  return posix.normalize(posix.join(base, spec)).replace(/^\.\//, '');
}

export function transformModule(source, moduleKey) {
  let out = source;

  // import { a, b } from './x.js';  ->  const { a, b } = __req('x.js');
  out = out.replace(
    /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, names, spec) => `const {${names}} = __req('${resolveKey(moduleKey, spec)}');`,
  );

  const exported = [];
  out = out.replace(
    /^export\s+(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    },
  );

  if (exported.length) {
    out += `\n${exported.map((n) => `__exports.${n} = ${n};`).join('\n')}\n`;
  }

  return out;
}

function listModules(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listModules(full));
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

export function bundle({ srcDir, entry, players, css, html }) {
  const modules = listModules(srcDir).map((file) => {
    const key = relative(srcDir, file).split(/[\\/]/).join('/');
    return { key, code: transformModule(readFileSync(file, 'utf8'), key) };
  });

  // Lazy registry: definition order does not matter, __req resolves on first use.
  const registry = [
    '(function () {',
    '"use strict";',
    'const __mods = {};',
    'const __cache = {};',
    'function __def(key, fn) { __mods[key] = fn; }',
    'function __req(key) {',
    '  if (__cache[key]) return __cache[key];',
    '  const fn = __mods[key];',
    '  if (!fn) throw new Error("Unknown module: " + key);',
    '  const __exports = {};',
    '  __cache[key] = __exports;',
    '  fn(__exports, __req);',
    '  return __exports;',
    '}',
    ...modules.map(
      ({ key, code }) =>
        `__def(${JSON.stringify(key)}, function (__exports, __req) {\n${code}\n});`,
    ),
    `__req(${JSON.stringify(entry)});`,
    '})();',
  ].join('\n');

  const dataScript = `window.PLAYERS = ${JSON.stringify(players)};`;

  return html
    .replace('/*<!--STYLES-->*/', css)
    .replace('/*<!--DATA-->*/', dataScript)
    .replace('/*<!--SCRIPT-->*/', registry);
}

function main() {
  const players = JSON.parse(readFileSync(join(ROOT, 'data', 'players.json'), 'utf8'));
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const html = readFileSync(join(SRC, 'index.html'), 'utf8');

  const out = bundle({ srcDir: SRC, entry: 'ui/app.js', players, css, html });
  writeFileSync(join(ROOT, 'draft.html'), out);
  console.log(`Wrote draft.html (${(out.length / 1024).toFixed(0)} KB, ${players.length} players)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 6: Create a placeholder entry point so the build can run**

Create `src/ui/app.js` (replaced fully in Task 12):
```js
import { el, clear } from './dom.js';

export function init() {
  const root = document.getElementById('app');
  clear(root);
  root.appendChild(el('div', { class: 'setup', text: `Loaded ${window.PLAYERS.length} players.` }, []));
}

init();
```

- [ ] **Step 7: Build and run the tests**

Run:
```bash
node scripts/build.mjs
node --test tests/build.test.js
open draft.html
```
Expected: build prints `Wrote draft.html (~130 KB, 300 players)`; 5 tests PASS; the browser shows `Loaded 300 players.` with no console errors.

If the page is blank, open the JS console — an "Unknown module" error means a module key was mis-resolved by `resolveKey`.

- [ ] **Step 8: Commit**

```bash
git add scripts/build.mjs src/index.html src/styles.css src/ui/dom.js src/ui/app.js tests/build.test.js draft.html
git commit -m "feat: add zero-dependency bundler producing a self-contained draft.html"
```

---

## Task 9: Setup screen

**Files:**
- Create: `src/ui/setup.js`
- Modify: `src/ui/app.js` (wire the setup screen to the placeholder init)
- Test: `tests/setup-config.test.js`

**Interfaces:**
- Consumes: `el`, `clear` from `src/ui/dom.js`; `DEFAULT_CONFIG` from `src/core/state.js`.
- Produces:
  - `buildConfig(form, numTeams) → Config` — pure; turns the raw form values into a valid config object. `form = { numTeams, rounds, myTeamIndex, slots, teams: [{ name, keeperId, keeperRound }] }`.
  - `validateConfig(config) → string[]` — human-readable errors; empty array when valid.
  - `renderSetup(root, initialConfig, onStart)` — draws the screen; calls `onStart(config)` when valid.

- [ ] **Step 1: Write the failing test**

Create `tests/setup-config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, validateConfig } from '../src/ui/setup.js';

const form = (over) => ({
  numTeams: 10, rounds: 15, myTeamIndex: 4,
  slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 },
  teams: Array.from({ length: 10 }, (_, i) => ({ name: `Team ${i + 1}`, keeperId: '', keeperRound: '' })),
  ...over,
});

test('buildConfig coerces strings to numbers and drops empty keepers', () => {
  const config = buildConfig(form({ numTeams: '10', rounds: '15', myTeamIndex: '7' }));
  assert.equal(config.numTeams, 10);
  assert.equal(config.rounds, 15);
  assert.equal(config.myTeamIndex, 7);
  assert.equal(config.teams.length, 10);
  assert.equal(config.teams[0].keeper, null);
});

test('buildConfig keeps a keeper with a player and a round', () => {
  const teams = form().teams;
  teams[2] = { name: 'Sharks', keeperId: 'p42', keeperRound: '3' };
  const config = buildConfig(form({ teams }));
  assert.deepEqual(config.teams[2], { name: 'Sharks', keeper: { playerId: 'p42', round: 3 } });
});

test('buildConfig ignores a keeper missing its round', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '' };
  assert.equal(buildConfig(form({ teams })).teams[0].keeper, null);
});

test('buildConfig falls back to a default name for a blank team name', () => {
  const teams = form().teams;
  teams[4] = { name: '   ', keeperId: '', keeperRound: '' };
  assert.equal(buildConfig(form({ teams })).teams[4].name, 'Team 5');
});

test('validateConfig accepts the league defaults', () => {
  assert.deepEqual(validateConfig(buildConfig(form())), []);
});

test('validateConfig rejects an out-of-range draft position', () => {
  const errors = validateConfig(buildConfig(form({ myTeamIndex: 11 })));
  assert.ok(errors.some((e) => /draft position/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects a roster that does not match the round count', () => {
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 2 };
  const errors = validateConfig(buildConfig(form({ slots })));
  assert.ok(errors.some((e) => /roster slots.*11.*15 rounds/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects duplicate keepers', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '1' };
  teams[1] = { name: 'B', keeperId: 'p1', keeperRound: '2' };
  const errors = validateConfig(buildConfig(form({ teams })));
  assert.ok(errors.some((e) => /same keeper/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects a keeper round beyond the draft', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '20' };
  const errors = validateConfig(buildConfig(form({ teams })));
  assert.ok(errors.some((e) => /keeper round/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects an implausible team count', () => {
  assert.ok(validateConfig(buildConfig(form({ numTeams: 1 }))).length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/setup-config.test.js`
Expected: FAIL — `Cannot find module '../src/ui/setup.js'`.

- [ ] **Step 3: Write `src/ui/setup.js`**

```js
import { el, clear } from './dom.js';
import { DEFAULT_CONFIG } from '../core/state.js';

const SLOT_FIELDS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BENCH'];

export function buildConfig(form) {
  const numTeams = Number(form.numTeams);
  const rounds = Number(form.rounds);

  const slots = {};
  for (const key of SLOT_FIELDS) slots[key] = Number(form.slots[key]) || 0;

  const teams = form.teams.slice(0, numTeams).map((team, i) => {
    const name = String(team.name || '').trim() || `Team ${i + 1}`;
    const hasKeeper = Boolean(team.keeperId) && Boolean(String(team.keeperRound).trim());
    return {
      name,
      keeper: hasKeeper
        ? { playerId: String(team.keeperId), round: Number(team.keeperRound) }
        : null,
    };
  });

  return {
    ...DEFAULT_CONFIG,
    numTeams,
    rounds,
    myTeamIndex: Number(form.myTeamIndex),
    slots,
    teams,
  };
}

export function validateConfig(config) {
  const errors = [];

  if (!(config.numTeams >= 4 && config.numTeams <= 16)) {
    errors.push('Number of teams must be between 4 and 16.');
  }
  if (!(config.rounds >= 1 && config.rounds <= 30)) {
    errors.push('Rounds must be between 1 and 30.');
  }
  if (!(config.myTeamIndex >= 1 && config.myTeamIndex <= config.numTeams)) {
    errors.push(`Draft position must be between 1 and ${config.numTeams}.`);
  }

  const slotTotal = SLOT_FIELDS.reduce((sum, key) => sum + (config.slots[key] || 0), 0);
  if (slotTotal !== config.rounds) {
    errors.push(`Roster slots total ${slotTotal} but there are ${config.rounds} rounds — they must match.`);
  }

  const keeperIds = new Set();
  for (const team of config.teams) {
    if (!team.keeper) continue;
    if (keeperIds.has(team.keeper.playerId)) {
      errors.push(`Two teams have the same keeper (${team.name}).`);
    }
    keeperIds.add(team.keeper.playerId);
    if (!(team.keeper.round >= 1 && team.keeper.round <= config.rounds)) {
      errors.push(`${team.name}: keeper round must be between 1 and ${config.rounds}.`);
    }
  }

  return errors;
}

function playerPicker(players, initialId, onChange) {
  const byId = new Map(players.map((p) => [p.id, p]));
  let selectedId = initialId || '';

  const input = el('input', {
    type: 'text',
    placeholder: 'search player…',
    value: selectedId && byId.has(selectedId) ? byId.get(selectedId).name : '',
  }, []);

  const list = el('div', { class: 'suggest-list', style: { display: 'none' } }, []);
  const wrap = el('div', { class: 'suggest' }, [input, list]);

  function close() {
    list.style.display = 'none';
    clear(list);
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    selectedId = '';
    onChange('');
    clear(list);
    if (query.length < 2) {
      close();
      return;
    }
    const matches = players.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8);
    for (const p of matches) {
      list.appendChild(el('div', {
        text: `${p.name} — ${p.position} ${p.team}`,
        onClick: () => {
          selectedId = p.id;
          input.value = p.name;
          onChange(p.id);
          close();
        },
      }, []));
    }
    list.style.display = matches.length ? 'block' : 'none';
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
  return wrap;
}

export function renderSetup(root, initialConfig, onStart) {
  const players = window.PLAYERS || [];
  const config = { ...DEFAULT_CONFIG, ...initialConfig };

  const form = {
    numTeams: config.numTeams,
    rounds: config.rounds,
    myTeamIndex: config.myTeamIndex,
    slots: { ...config.slots },
    teams: Array.from({ length: config.numTeams }, (_, i) => ({
      name: (config.teams[i] && config.teams[i].name) || `Team ${i + 1}`,
      keeperId: (config.teams[i] && config.teams[i].keeper && config.teams[i].keeper.playerId) || '',
      keeperRound: (config.teams[i] && config.teams[i].keeper && config.teams[i].keeper.round) || '',
    })),
  };

  clear(root);
  const errorBox = el('div', { class: 'notes', style: { display: 'none' } }, []);

  const numberField = (label, key, min, max) => el('div', { class: 'field' }, [
    el('label', { text: label }, []),
    el('input', {
      type: 'number', min, max, value: form[key],
      onInput: (e) => { form[key] = e.target.value; },
    }, []),
  ]);

  // Draft position buttons.
  const positionRow = el('div', { class: 'pos-grid' }, []);
  const drawPositions = () => {
    clear(positionRow);
    for (let i = 1; i <= Number(form.numTeams); i += 1) {
      positionRow.appendChild(el('button', {
        class: `pos-btn${Number(form.myTeamIndex) === i ? ' selected' : ''}`,
        text: String(i),
        onClick: () => { form.myTeamIndex = i; drawPositions(); },
      }, []));
    }
  };
  drawPositions();

  const slotFields = el('div', { class: 'field-row' }, SLOT_FIELDS.map((key) => el('div', { class: 'field' }, [
    el('label', { text: key }, []),
    el('input', {
      type: 'number', min: 0, max: 12, value: form.slots[key],
      style: { width: '64px' },
      onInput: (e) => { form.slots[key] = e.target.value; },
    }, []),
  ])));

  const teamRows = form.teams.map((team, i) => el('tr', {}, [
    el('td', { text: String(i + 1) }, []),
    el('td', {}, [el('input', {
      type: 'text', value: team.name,
      onInput: (e) => { form.teams[i].name = e.target.value; },
    }, [])]),
    el('td', {}, [playerPicker(players, team.keeperId, (id) => { form.teams[i].keeperId = id; })]),
    el('td', {}, [el('select', {
      onChange: (e) => { form.teams[i].keeperRound = e.target.value; },
    }, [
      el('option', { value: '', text: '—' }, []),
      ...Array.from({ length: Number(form.rounds) }, (_, r) => el('option', {
        value: String(r + 1), text: String(r + 1),
        selected: String(team.keeperRound) === String(r + 1) ? 'selected' : null,
      }, [])),
    ])]),
  ]));

  root.appendChild(el('div', { class: 'panel setup' }, [
    el('h1', { text: 'Draft Assistant — Setup' }, []),
    errorBox,

    el('h2', { text: 'League Settings' }, []),
    el('div', { class: 'field-row' }, [
      numberField('Teams', 'numTeams', 4, 16),
      numberField('Rounds', 'rounds', 1, 30),
      el('div', { class: 'field' }, [
        el('label', { text: 'Scoring' }, []),
        el('select', { disabled: 'disabled' }, [el('option', { text: 'Standard (non-PPR)' }, [])]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Draft type' }, []),
        el('select', { disabled: 'disabled' }, [el('option', { text: 'Snake' }, [])]),
      ]),
    ]),

    el('h2', { text: 'Your Draft Position' }, []),
    positionRow,

    el('h2', { text: 'Roster Slots' }, []),
    slotFields,

    el('h2', { text: 'Teams & Keepers' }, []),
    el('table', { class: 'teams' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '#' }, []), el('th', { text: 'Team name' }, []),
        el('th', { text: 'Keeper (optional)' }, []), el('th', { text: 'Round' }, []),
      ])]),
      el('tbody', {}, teamRows),
    ]),

    el('button', {
      class: 'primary',
      text: 'Start Draft',
      onClick: () => {
        const built = buildConfig(form);
        const errors = validateConfig(built);
        if (errors.length) {
          clear(errorBox);
          errorBox.style.display = 'block';
          for (const message of errors) errorBox.appendChild(el('div', { text: message }, []));
          return;
        }
        errorBox.style.display = 'none';
        onStart(built);
      },
    }, []),
  ]));
}
```

- [ ] **Step 4: Wire it into `src/ui/app.js`**

Replace `src/ui/app.js` with:
```js
import { clear } from './dom.js';
import { renderSetup } from './setup.js';
import { DEFAULT_CONFIG, createState, saveState } from '../core/state.js';

export function init() {
  const root = document.getElementById('app');
  clear(root);
  renderSetup(root, DEFAULT_CONFIG, (config) => {
    const state = createState(config);
    saveState(state);
    root.textContent = `Draft started: ${Object.keys(state.picks).length} keeper(s) placed.`;
  });
}

init();
```

- [ ] **Step 5: Run the tests and check the page**

Run:
```bash
node --test tests/
node scripts/build.mjs
open draft.html
```
Expected: all tests PASS. The setup screen renders with 10 team rows, draft position 4 pre-selected, and keeper autocomplete returning real players after typing 2+ letters. Clicking **Start Draft** replaces the page with the "Draft started" line. Setting BENCH to 2 and clicking Start shows the roster-slot mismatch error instead.

- [ ] **Step 6: Commit**

```bash
git add src/ui/setup.js src/ui/app.js tests/setup-config.test.js draft.html
git commit -m "feat: add setup screen with league settings, draft position, and keepers"
```

---

## Task 10: Left panel — my team and positional needs

**Files:**
- Create: `src/ui/myteam.js`
- Test: `tests/myteam.test.js`

**Interfaces:**
- Consumes: `assignSlots`, `positionalNeeds`, `ALL_POSITIONS` from `src/core/roster.js`; `el`, `clear`, `POSITION_COLORS` from `src/ui/dom.js`.
- Produces:
  - `needSummary(roster, slots, round, totalRounds) → Array<{ position, tier, label }>` — pure, sorted high → none, with a human label like `'RB2 needed'`.
  - `renderMyTeam(container, ctx)` where `ctx = { roster, slots, round, totalRounds, teamName }`.

- [ ] **Step 1: Write the failing test**

Create `tests/myteam.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needSummary } from '../src/ui/myteam.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const p = (id, position) => ({
  id, name: id, team: 'XX', position, projectedPoints: 100,
  overallRank: 1, positionRank: 1, adp: null, bye: null,
});

test('needSummary lists every position sorted high need first', () => {
  const summary = needSummary([], DEFAULT_SLOTS, 1, 15);
  assert.equal(summary.length, 6);
  assert.equal(summary[0].tier, 'high');
  assert.equal(summary[summary.length - 1].tier, 'none', 'K/DEF sink to the bottom in round 1');
});

test('needSummary labels the first starter at an empty position', () => {
  const rb = needSummary([], DEFAULT_SLOTS, 1, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'high');
  assert.equal(rb.label, 'RB1 needed');
});

test('needSummary labels the second starter once the first is filled', () => {
  const rb = needSummary([p('a', 'RB')], DEFAULT_SLOTS, 2, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'medium');
  assert.equal(rb.label, 'RB2 needed');
});

test('needSummary reports depth once starters are full', () => {
  const roster = [p('a', 'RB'), p('b', 'RB')];
  const rb = needSummary(roster, DEFAULT_SLOTS, 3, 15).find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'low');
  assert.equal(rb.label, 'FLEX / bench depth');
});

test('needSummary marks a filled position as set', () => {
  const qb = needSummary([p('q', 'QB')], DEFAULT_SLOTS, 3, 15).find((n) => n.position === 'QB');
  assert.equal(qb.label, 'QB set — depth only');
});

test('needSummary defers K and DEF until late', () => {
  const early = needSummary([], DEFAULT_SLOTS, 5, 15).find((n) => n.position === 'K');
  assert.equal(early.tier, 'none');
  assert.equal(early.label, 'wait until round 13');

  const late = needSummary([], DEFAULT_SLOTS, 13, 15).find((n) => n.position === 'K');
  assert.equal(late.tier, 'high');
  assert.equal(late.label, 'K needed');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/myteam.test.js`
Expected: FAIL — `Cannot find module '../src/ui/myteam.js'`.

- [ ] **Step 3: Write `src/ui/myteam.js`**

```js
import { el, clear, POSITION_COLORS } from './dom.js';
import {
  assignSlots, positionalNeeds, countByPosition, ALL_POSITIONS, NEED_TIERS, LATE_ROUND_WINDOW,
} from '../core/roster.js';

function needLabel(position, tier, have, required, totalRounds) {
  if (position === 'K' || position === 'DEF') {
    if (tier === 'none' && have >= required) return `${position} set`;
    if (tier === 'none') return `wait until round ${totalRounds - LATE_ROUND_WINDOW + 1}`;
    return `${position} needed`;
  }
  if (tier === 'high') return required > 1 ? `${position}1 needed` : `${position} needed`;
  if (tier === 'medium') return `${position}${have + 1} needed`;
  if (have >= required && required > 0) {
    return position === 'QB' || position === 'TE'
      ? `${position} set — depth only`
      : 'FLEX / bench depth';
  }
  return 'FLEX / bench depth';
}

export function needSummary(roster, slots, round, totalRounds) {
  const needs = positionalNeeds(roster, slots, round, totalRounds);
  const counts = countByPosition(roster);

  return ALL_POSITIONS
    .map((position) => ({
      position,
      tier: needs[position],
      label: needLabel(position, needs[position], counts[position], slots[position] || 0, totalRounds),
    }))
    .sort((a, b) => NEED_TIERS.indexOf(a.tier) - NEED_TIERS.indexOf(b.tier)
      || ALL_POSITIONS.indexOf(a.position) - ALL_POSITIONS.indexOf(b.position));
}

export function renderMyTeam(container, ctx) {
  const { roster, slots, round, totalRounds, teamName } = ctx;
  clear(container);

  container.appendChild(el('h2', { text: `My Team — ${teamName}` }, []));

  for (const slot of assignSlots(roster, slots)) {
    const player = slot.player;
    container.appendChild(el('div', { class: 'slot' }, [
      el('span', { class: 'label', text: slot.label }, []),
      el('span', {
        class: `name${player ? '' : ' empty'}`,
        text: player ? `${player.name} (${player.team})` : 'empty',
        style: player ? { color: POSITION_COLORS[player.position] } : {},
        title: player ? `${player.position} · ${player.projectedPoints} proj · bye ${player.bye ?? '—'}` : '',
      }, []),
    ]));
  }

  const needs = el('div', { class: 'needs' }, [el('h2', { text: 'Positional Needs' }, [])]);
  for (const need of needSummary(roster, slots, round, totalRounds)) {
    needs.appendChild(el('div', { class: 'need-row' }, [
      el('span', {
        text: need.label,
        style: { color: POSITION_COLORS[need.position] },
      }, []),
      el('span', { class: `tier tier-${need.tier}`, text: need.tier }, []),
    ]));
  }
  container.appendChild(needs);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/myteam.test.js`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/myteam.js tests/myteam.test.js
git commit -m "feat: add my-team panel with roster slots and need tiers"
```

---

## Task 11: Center panel — pick entry, recommendations, available players

**Files:**
- Create: `src/ui/center.js`
- Test: `tests/center.test.js`

**Interfaces:**
- Consumes: `recommend` from `src/core/recommend.js`; `competitiveNotes` from `src/core/competitive.js`; `el`, `clear`, `POSITION_COLORS`, `formatPick` from `src/ui/dom.js`.
- Produces:
  - `SORT_KEYS` — `['overallRank', 'position', 'vbd', 'adp']`
  - `searchPlayers(pool, query, limit = 8) → Player[]` — case-insensitive substring match on name or team, best-rank first.
  - `sortPlayers(pool, key) → Player[]` — non-mutating; `overallRank`/`adp` ascending (nulls last), `vbd` descending, `position` groups by QB,RB,WR,TE,K,DEF then rank.
  - `filterByPosition(pool, position) → Player[]` — `position` of `'ALL'` returns everything.
  - `renderCenter(container, ctx, handlers)` where
    `ctx = { pool, myRoster, needs, currentPick, nextPick, round, numTeams, isMyPick, pickingTeamName, notes }`
    and `handlers = { onPick(playerId), onUndo() }`.

- [ ] **Step 1: Write the failing test**

Create `tests/center.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlayers, sortPlayers, filterByPosition, SORT_KEYS } from '../src/ui/center.js';

const p = (id, name, position, overallRank, extra) => ({
  id, name, team: (extra && extra.team) || 'XX', position, overallRank,
  positionRank: 1, projectedPoints: 300 - overallRank,
  vbd: (extra && extra.vbd) !== undefined ? extra.vbd : 100 - overallRank,
  adp: (extra && extra.adp) !== undefined ? extra.adp : overallRank, bye: 7,
});

const POOL = [
  p('1', 'Jahmyr Gibbs', 'RB', 1),
  p('2', 'Bijan Robinson', 'RB', 2),
  p('3', "Ja'Marr Chase", 'WR', 3, { team: 'CIN' }),
  p('4', 'Josh Allen', 'QB', 4, { vbd: 5 }),
  p('5', 'Brock Bowers', 'TE', 5, { adp: null }),
];

test('SORT_KEYS covers the four sorts named in the spec', () => {
  assert.deepEqual(SORT_KEYS, ['overallRank', 'position', 'vbd', 'adp']);
});

test('searchPlayers matches a partial name, case-insensitively', () => {
  assert.deepEqual(searchPlayers(POOL, 'gib').map((x) => x.id), ['1']);
  assert.deepEqual(searchPlayers(POOL, 'ROBIN').map((x) => x.id), ['2']);
});

test('searchPlayers matches on team abbreviation', () => {
  assert.deepEqual(searchPlayers(POOL, 'cin').map((x) => x.id), ['3']);
});

test('searchPlayers handles apostrophes in names', () => {
  assert.deepEqual(searchPlayers(POOL, "ja'marr").map((x) => x.id), ['3']);
});

test('searchPlayers returns best rank first and honours the limit', () => {
  const many = Array.from({ length: 20 }, (_, i) => p(`x${i}`, `Test Player ${i}`, 'WR', 20 - i));
  const found = searchPlayers(many, 'test', 5);
  assert.equal(found.length, 5);
  assert.equal(found[0].overallRank, 1);
});

test('searchPlayers returns nothing for a blank query', () => {
  assert.deepEqual(searchPlayers(POOL, '  '), []);
});

test('sortPlayers by overallRank is ascending', () => {
  assert.deepEqual(sortPlayers(POOL, 'overallRank').map((x) => x.id), ['1', '2', '3', '4', '5']);
});

test('sortPlayers by vbd is descending', () => {
  const sorted = sortPlayers(POOL, 'vbd');
  assert.equal(sorted[0].id, '1');
  assert.equal(sorted[sorted.length - 1].id, '4', 'lowest VBD lands last');
});

test('sortPlayers by adp puts nulls last', () => {
  assert.equal(sortPlayers(POOL, 'adp').at(-1).id, '5');
});

test('sortPlayers by position groups QB, RB, WR, TE, K, DEF', () => {
  assert.deepEqual(sortPlayers(POOL, 'position').map((x) => x.position),
    ['QB', 'RB', 'RB', 'WR', 'TE']);
});

test('sortPlayers does not mutate its input', () => {
  const before = POOL.map((x) => x.id);
  sortPlayers(POOL, 'vbd');
  assert.deepEqual(POOL.map((x) => x.id), before);
});

test('filterByPosition narrows the pool and ALL passes it through', () => {
  assert.deepEqual(filterByPosition(POOL, 'RB').map((x) => x.id), ['1', '2']);
  assert.equal(filterByPosition(POOL, 'ALL').length, 5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/center.test.js`
Expected: FAIL — `Cannot find module '../src/ui/center.js'`.

- [ ] **Step 3: Write `src/ui/center.js`**

```js
import { el, clear, POSITION_COLORS, formatPick } from './dom.js';
import { recommend } from '../core/recommend.js';

export const SORT_KEYS = ['overallRank', 'position', 'vbd', 'adp'];
export const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export function searchPlayers(pool, query, limit = 8) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return pool
    .filter((pl) => pl.name.toLowerCase().includes(needle) || pl.team.toLowerCase() === needle)
    .sort((a, b) => a.overallRank - b.overallRank)
    .slice(0, limit);
}

export function sortPlayers(pool, key) {
  const copy = [...pool];
  if (key === 'vbd') return copy.sort((a, b) => b.vbd - a.vbd);
  if (key === 'adp') {
    return copy.sort((a, b) => {
      if (a.adp === null && b.adp === null) return a.overallRank - b.overallRank;
      if (a.adp === null) return 1;
      if (b.adp === null) return -1;
      return a.adp - b.adp;
    });
  }
  if (key === 'position') {
    return copy.sort((a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
      || a.overallRank - b.overallRank);
  }
  return copy.sort((a, b) => a.overallRank - b.overallRank);
}

export function filterByPosition(pool, position) {
  return position === 'ALL' ? [...pool] : pool.filter((pl) => pl.position === position);
}

// Module-level view state so a re-render keeps the user's sort/filter/search choices.
const view = { sortKey: 'overallRank', filter: 'ALL', query: '' };

function pickEntry(pool, onPick, onUndo) {
  const input = el('input', {
    type: 'text', placeholder: 'Type a player name, then Enter…', autocomplete: 'off',
  }, []);
  const list = el('div', { class: 'suggest-list', style: { display: 'none' } }, []);
  let matches = [];
  let active = 0;

  function close() {
    list.style.display = 'none';
    clear(list);
    matches = [];
    active = 0;
  }

  function draw() {
    clear(list);
    matches.forEach((pl, i) => {
      list.appendChild(el('div', {
        class: i === active ? 'active' : '',
        text: `${pl.name} — ${pl.position} ${pl.team} (#${pl.overallRank})`,
        onMousedown: (e) => { e.preventDefault(); onPick(pl.id); close(); input.value = ''; },
      }, []));
    });
    list.style.display = matches.length ? 'block' : 'none';
  }

  input.addEventListener('input', () => {
    matches = searchPlayers(pool, input.value);
    active = 0;
    draw();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[active]) {
      onPick(matches[active].id);
      input.value = '';
      close();
      e.preventDefault();
    } else if (e.key === 'Escape') close();
  });

  const wrap = el('div', { class: 'pickbar' }, [
    el('div', { class: 'suggest', style: { flex: '1' } }, [input, list]),
    el('button', { text: 'Undo', onClick: onUndo }, []),
  ]);

  // Focus is restored after each render so the user can type pick after pick without reaching for the mouse.
  setTimeout(() => input.focus(), 0);
  return wrap;
}

function recommendationCard(rec) {
  const pl = rec.player;
  return el('div', {
    class: 'rec',
    style: { borderLeftColor: POSITION_COLORS[pl.position] },
  }, [
    el('div', { class: 'top' }, [
      el('span', { class: 'pname', text: `${pl.name}` }, []),
      el('span', {
        class: 'meta',
        text: `${pl.position} · ${pl.team} · #${pl.overallRank} BPA · VBD +${Math.round(pl.vbd)}`,
      }, []),
    ]),
    el('div', { class: 'meta', text: `${pl.position} need: ${rec.need}${pl.adp === null ? '' : ` · ADP ${pl.adp}`}` }, []),
    ...rec.reasons.map((reason) => el('div', { class: 'why', text: reason }, [])),
  ]);
}

function playerTable(pool, onPick) {
  const rows = filterByPosition(sortPlayers(pool, view.sortKey), view.filter)
    .filter((pl) => !view.query || pl.name.toLowerCase().includes(view.query.toLowerCase()))
    .slice(0, 250)
    .map((pl) => el('tr', { onDblclick: () => onPick(pl.id) }, [
      el('td', { text: String(pl.overallRank) }, []),
      el('td', { text: pl.name }, []),
      el('td', { text: pl.position, style: { color: POSITION_COLORS[pl.position] } }, []),
      el('td', { text: pl.team }, []),
      el('td', { text: String(pl.projectedPoints) }, []),
      el('td', { text: String(Math.round(pl.vbd)) }, []),
      el('td', { text: pl.adp === null ? '—' : String(pl.adp) }, []),
      el('td', { text: pl.bye === null ? '—' : String(pl.bye) }, []),
    ]));

  const header = (label, key) => el('th', {
    text: view.sortKey === key ? `${label} ▾` : label,
    onClick: key ? () => { view.sortKey = key; rerender(); } : null,
  }, []);

  return el('table', { class: 'players' }, [
    el('thead', {}, [el('tr', {}, [
      header('#', 'overallRank'), header('Player', null), header('Pos', 'position'),
      header('Tm', null), header('Proj', null), header('VBD', 'vbd'),
      header('ADP', 'adp'), header('Bye', null),
    ])]),
    el('tbody', {}, rows),
  ]);
}

// Set by renderCenter so the sort/filter controls can redraw without the caller's help.
let rerender = () => {};

export function renderCenter(container, ctx, handlers) {
  rerender = () => renderCenter(container, ctx, handlers);
  clear(container);

  const {
    pool, needs, currentPick, nextPick, round, numTeams, isMyPick, pickingTeamName, notes,
  } = ctx;

  container.appendChild(el('div', { class: 'pick-info' }, [
    el('span', {
      class: 'round',
      text: currentPick === null ? 'Draft complete' : `Round ${round} · Pick ${formatPick(currentPick, numTeams)}`,
    }, []),
    el('span', {
      class: `who${isMyPick ? ' mine' : ''}`,
      text: currentPick === null ? ''
        : isMyPick ? 'YOUR PICK' : `${pickingTeamName} is on the clock`,
    }, []),
    !isMyPick && nextPick ? el('span', {
      class: 'meta',
      text: `Your next: ${formatPick(nextPick, numTeams)} (${nextPick - currentPick} picks away)`,
    }, []) : null,
  ]));

  container.appendChild(pickEntry(pool, handlers.onPick, handlers.onUndo));

  for (const note of notes || []) {
    container.appendChild(el('div', { class: 'notes', text: note }, []));
  }

  if (isMyPick && pool.length) {
    container.appendChild(el('h2', { text: 'Recommended' }, []));
    const recs = recommend(pool, { needs, currentPick, nextPick, round }, 3);
    for (const rec of recs) container.appendChild(recommendationCard(rec));
  }

  const filters = el('div', { class: 'filters' }, [
    ...POSITION_FILTERS.map((position) => el('button', {
      class: view.filter === position ? 'selected' : '',
      text: position,
      onClick: () => { view.filter = position; rerender(); },
    }, [])),
    el('input', {
      type: 'text', placeholder: 'filter list…', value: view.query,
      onInput: (e) => {
        view.query = e.target.value;
        const table = container.querySelector('table.players');
        if (table) table.replaceWith(playerTable(pool, handlers.onPick));
      },
    }, []),
  ]);

  container.appendChild(el('h2', { text: `Available (${pool.length})` }, []));
  container.appendChild(filters);
  container.appendChild(playerTable(pool, handlers.onPick));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/center.test.js`
Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js tests/center.test.js
git commit -m "feat: add center panel with pick entry, recommendations, and player list"
```

---

## Task 12: Right panel — draft board grid, app wiring, and README

**Files:**
- Create: `src/ui/board.js`
- Modify: `src/ui/app.js` (full replacement)
- Create: `README.md`
- Test: `tests/board.test.js`

**Interfaces:**
- Consumes: `pickToSlot`, `slotToPick` from `src/core/snake.js`; `el`, `clear`, `POSITION_COLORS`, `abbreviate` from `src/ui/dom.js`; `assignSlots`, `positionalNeeds` from `src/core/roster.js`; everything from `src/core/state.js`, `src/core/vbd.js`, `src/core/recommend.js`, `src/core/competitive.js`.
- Produces:
  - `boardCells(state, allPlayers) → Array<Array<{ pick, teamIndex, round, player, isKeeper, isMine, isCurrent }>>` — one inner array per round, each of length `numTeams`, indexed by `teamIndex - 1` (display order, not snake order).
  - `renderBoard(container, ctx)` where `ctx = { state, allPlayers, currentPick }`.
  - `src/ui/app.js` exporting `init()`.

- [ ] **Step 1: Write the failing test**

Create `tests/board.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardCells } from '../src/ui/board.js';
import { DEFAULT_CONFIG, createState, applyPick } from '../src/core/state.js';

const PLAYERS = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i + 1}`, name: `First Last${i + 1}`, team: 'XX',
  position: ['RB', 'WR', 'QB', 'TE'][i % 4],
  overallRank: i + 1, positionRank: 1, projectedPoints: 300 - i, adp: i + 1, bye: 7,
}));

test('boardCells is rounds x teams in display order', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid.length, 3);
  assert.equal(grid[0].length, 10);
  assert.deepEqual(grid[0].map((c) => c.teamIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(grid[1].map((c) => c.teamIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'display order stays left-to-right even in reversed rounds');
});

test('boardCells maps round 2 columns back to the snake pick numbers', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[1][0].pick, 20, 'team 1 picks last in round 2');
  assert.equal(grid[1][9].pick, 11, 'team 10 picks first in round 2');
});

test('boardCells attaches drafted players to their cells', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 3 });
  state = applyPick(state, 'p1');
  state = applyPick(state, 'p2');
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[0][0].player.id, 'p1');
  assert.equal(grid[0][1].player.id, 'p2');
  assert.equal(grid[0][2].player, null);
});

test('boardCells flags the current pick and the user\'s column', () => {
  const state = createState({ ...DEFAULT_CONFIG, rounds: 3, myTeamIndex: 4 });
  const grid = boardCells(state, PLAYERS);
  assert.equal(grid[0][0].isCurrent, true);
  assert.equal(grid[0][1].isCurrent, false);
  assert.ok(grid.every((row) => row[3].isMine), 'column 4 is mine in every round');
  assert.ok(grid.every((row) => !row[0].isMine));
});

test('boardCells flags keepers', () => {
  const config = {
    ...DEFAULT_CONFIG,
    rounds: 3,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 5 ? { ...t, keeper: { playerId: 'p9', round: 2 } } : t)),
  };
  const grid = boardCells(createState(config), PLAYERS);
  const cell = grid[1].find((c) => c.teamIndex === 6);
  assert.equal(cell.isKeeper, true);
  assert.equal(cell.player.id, 'p9');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/board.test.js`
Expected: FAIL — `Cannot find module '../src/ui/board.js'`.

- [ ] **Step 3: Write `src/ui/board.js`**

```js
import { el, clear, POSITION_COLORS, abbreviate } from './dom.js';
import { slotToPick } from '../core/snake.js';
import { assignSlots, positionalNeeds } from '../core/roster.js';
import { currentPickNumber, rosterFor } from '../core/state.js';

export function boardCells(state, allPlayers) {
  const { numTeams, rounds, myTeamIndex } = state.config;
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  const current = currentPickNumber(state);

  const grid = [];
  for (let round = 1; round <= rounds; round += 1) {
    const row = [];
    for (let teamIndex = 1; teamIndex <= numTeams; teamIndex += 1) {
      const pick = slotToPick(round, teamIndex, numTeams);
      const entry = state.picks[pick] || null;
      row.push({
        pick,
        round,
        teamIndex,
        player: entry ? byId.get(entry.playerId) || null : null,
        isKeeper: Boolean(entry && entry.isKeeper),
        isMine: teamIndex === myTeamIndex,
        isCurrent: pick === current,
      });
    }
    grid.push(row);
  }
  return grid;
}

let openPopover = null;

function closePopover() {
  if (openPopover && openPopover.parentNode) openPopover.parentNode.removeChild(openPopover);
  openPopover = null;
}

function showRosterPopover(event, state, allPlayers, teamIndex) {
  closePopover();
  const { slots, rounds } = state.config;
  const roster = rosterFor(state, teamIndex, allPlayers);
  const round = Math.min(rounds, Math.floor(roster.length) + 1);
  const needs = positionalNeeds(roster, slots, round, rounds);

  const pop = el('div', { class: 'roster-pop' }, [
    el('div', { style: { fontWeight: '600', marginBottom: '6px' }, text: state.config.teams[teamIndex - 1].name }, []),
    ...assignSlots(roster, slots).map((slot) => el('div', { class: 'slot' }, [
      el('span', { class: 'label', text: slot.label }, []),
      el('span', {
        class: `name${slot.player ? '' : ' empty'}`,
        text: slot.player ? slot.player.name : 'empty',
        style: slot.player ? { color: POSITION_COLORS[slot.player.position] } : {},
      }, []),
    ])),
    el('div', { style: { marginTop: '6px', color: '#8b93a5' }, text: 'Needs' }, []),
    ...Object.keys(needs).map((pos) => el('div', { class: 'need-row' }, [
      el('span', { text: pos, style: { color: POSITION_COLORS[pos] } }, []),
      el('span', { class: `tier tier-${needs[pos]}`, text: needs[pos] }, []),
    ])),
  ]);

  pop.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
  pop.style.top = `${Math.min(event.clientY, window.innerHeight - 400)}px`;
  document.body.appendChild(pop);
  openPopover = pop;
  setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
}

export function renderBoard(container, ctx) {
  const { state, allPlayers } = ctx;
  const { numTeams, teams, myTeamIndex } = state.config;
  clear(container);
  closePopover();

  container.appendChild(el('h2', { text: 'Draft Board' }, []));

  const headerCells = [el('th', { class: 'rnd', text: 'R' }, [])];
  for (let teamIndex = 1; teamIndex <= numTeams; teamIndex += 1) {
    headerCells.push(el('th', {
      class: teamIndex === myTeamIndex ? 'mine' : '',
      text: teams[teamIndex - 1].name,
      title: 'Click for this team\'s roster and needs',
      onClick: (e) => { e.stopPropagation(); showRosterPopover(e, state, allPlayers, teamIndex); },
    }, []));
  }

  const rows = boardCells(state, allPlayers).map((row, i) => {
    const round = i + 1;
    // Odd rounds run left to right, even rounds right to left.
    const arrow = round % 2 === 1 ? '→' : '←';
    const cells = [el('td', { class: 'rnd', text: `${round}${arrow}` }, [])];

    for (const cell of row) {
      const classes = ['cell'];
      if (cell.isMine) classes.push('mine-col');
      if (cell.isCurrent) classes.push('current');
      if (cell.isKeeper) classes.push('keeper');

      cells.push(el('td', {
        class: classes.join(' '),
        text: cell.player ? abbreviate(cell.player.name) : '',
        style: cell.player ? { color: POSITION_COLORS[cell.player.position] } : {},
        title: cell.player
          ? `${cell.player.name} — ${cell.player.position} ${cell.player.team}\n`
            + `#${cell.player.overallRank} overall · ${cell.player.projectedPoints} proj · `
            + `ADP ${cell.player.adp ?? '—'} · bye ${cell.player.bye ?? '—'}`
          : `Pick ${cell.pick}`,
      }, []));
    }

    return el('tr', {}, cells);
  });

  container.appendChild(el('table', { class: 'board' }, [
    el('thead', {}, [el('tr', {}, headerCells)]),
    el('tbody', {}, rows),
  ]));
}
```

- [ ] **Step 4: Replace `src/ui/app.js` with the full wiring**

```js
import { el, clear } from './dom.js';
import { renderSetup } from './setup.js';
import { renderMyTeam } from './myteam.js';
import { renderCenter } from './center.js';
import { renderBoard } from './board.js';
import { pickToSlot } from '../core/snake.js';
import { positionalNeeds } from '../core/roster.js';
import { replacementPoints, withVbd } from '../core/vbd.js';
import { competitiveNotes } from '../core/competitive.js';
import {
  DEFAULT_CONFIG, createState, currentPickNumber, applyPick, undoPick,
  availablePlayers, rosterFor, rostersByTeam, myNextPick,
  saveState, loadState, clearState,
} from '../core/state.js';

let state = null;
let allPlayers = [];
let replacement = null;

function root() {
  return document.getElementById('app');
}

function startDraft(config) {
  state = createState(config);
  saveState(state);
  renderDraft();
}

function showSetup() {
  const container = root();
  clear(container);
  renderSetup(container, (state && state.config) || DEFAULT_CONFIG, startDraft);
}

function handlePick(playerId) {
  try {
    state = applyPick(state, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  saveState(state);
  renderDraft();
}

function handleUndo() {
  state = undoPick(state);
  saveState(state);
  renderDraft();
}

function handleReset() {
  if (!window.confirm('Clear this draft and return to setup?')) return;
  clearState();
  state = null;
  showSetup();
}

function renderDraft() {
  const container = root();
  const { config } = state;
  const currentPick = currentPickNumber(state);
  const round = currentPick === null ? config.rounds : pickToSlot(currentPick, config.numTeams).round;
  const pickingTeam = currentPick === null ? null : pickToSlot(currentPick, config.numTeams).teamIndex;
  const isMyPick = pickingTeam === config.myTeamIndex;

  // VBD baselines are computed once from the full pool, so replacement level does not
  // drift as players come off the board — that is what makes VBD comparable all draft.
  const pool = withVbd(availablePlayers(state, allPlayers), replacement);
  const myRoster = rosterFor(state, config.myTeamIndex, allPlayers);
  const needs = positionalNeeds(myRoster, config.slots, round, config.rounds);
  const nextPick = myNextPick(state);

  const notes = isMyPick
    ? competitiveNotes({
      currentPick,
      nextPick: nextPick === currentPick
        ? myNextPick({ ...state, picks: { ...state.picks, [currentPick]: { playerId: '', teamIndex: pickingTeam, isKeeper: false } } })
        : nextPick,
      numTeams: config.numTeams,
      rounds: config.rounds,
      rostersByTeam: rostersByTeam(state, allPlayers),
      slots: config.slots,
      pool,
      replacement,
    })
    : [];

  clear(container);
  const left = el('div', { class: 'panel' }, []);
  const center = el('div', { class: 'panel' }, []);
  const right = el('div', { class: 'panel' }, []);

  container.appendChild(el('div', { class: 'layout' }, [left, center, right]));

  renderMyTeam(left, {
    roster: myRoster,
    slots: config.slots,
    round,
    totalRounds: config.rounds,
    teamName: config.teams[config.myTeamIndex - 1].name,
  });
  left.appendChild(el('button', {
    text: 'Reset draft', style: { marginTop: '12px' }, onClick: handleReset,
  }, []));

  renderCenter(center, {
    pool,
    myRoster,
    needs,
    currentPick,
    nextPick,
    round,
    numTeams: config.numTeams,
    isMyPick,
    pickingTeamName: pickingTeam ? config.teams[pickingTeam - 1].name : '',
    notes,
  }, { onPick: handlePick, onUndo: handleUndo });

  renderBoard(right, { state, allPlayers, currentPick });
}

export function init() {
  allPlayers = window.PLAYERS || [];
  replacement = replacementPoints(allPlayers, DEFAULT_CONFIG.numTeams, DEFAULT_CONFIG.slots);

  const saved = loadState();
  if (saved) {
    state = saved;
    replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
    renderDraft();
  } else {
    showSetup();
  }
}

init();
```

- [ ] **Step 5: Write `README.md`**

````markdown
# Fantasy Football Draft Assistant

A single-file, offline browser app for a live 10-team standard-scoring snake draft.
Tracks every pick, manages the player pool, and recommends picks from a composite
of BPA, positional need, and value-based drafting.

## Draft-day checklist

Run this the morning of the draft, on a machine with internet:

```bash
npm run fetch     # refresh data/players.json from ESPN + Fantasy Football Calculator
npm run build     # regenerate draft.html
npm test          # confirm everything still passes
```

Then open `draft.html` by double-clicking it. **No internet is needed after this
point** — the page is fully self-contained.

## Using it

1. **Setup** — confirm teams/rounds/roster slots, click your draft position, enter
   any keepers (player + round). Click **Start Draft**.
2. **Every pick** — type the player's name in the box at the top of the center
   panel, arrow to the right match, press Enter. Works for other teams' picks too;
   the app always logs to whichever team is on the clock.
3. **Your pick** — the top 3 recommendations appear with a one-line "why" and any
   positional-run warnings.
4. **Mistakes** — click **Undo** to reverse the last pick.
5. **Refresh** — the draft is saved to `localStorage`, so reloading the page
   restores everything. **Reset draft** clears it and returns to setup.

## Data sources

| Field | Source |
|---|---|
| Overall rank, projected points | ESPN fantasy standard-scoring projections |
| ADP | Fantasy Football Calculator, 10-team non-PPR mock drafts |
| Bye weeks | ESPN pro-team schedule |

## Development

```bash
npm test                  # all unit tests (Node's built-in runner, no dependencies)
node scripts/build.mjs    # bundle src/ + data/ into draft.html
```

Source lives in `src/core/` (pure logic, fully unit-tested) and `src/ui/` (DOM).
`scripts/build.mjs` inlines everything into `draft.html`, so **`draft.html` is a
build artifact — never edit it by hand.**

Modules under `src/` must use only `import { a } from './rel.js';` and
`export function|const|class` — the bundler is a small regex transform and does
not understand default exports, export lists, or namespace imports.
````

- [ ] **Step 6: Run the full suite, build, and exercise the app end to end**

Run:
```bash
node --test tests/
node scripts/build.mjs
open draft.html
```

Expected: every test PASSES; `draft.html` rebuilds. Then verify by hand in the browser:

1. Setup screen shows 10 teams, position 4 selected. Set team 1's keeper to any player, round 1. Click **Start Draft**.
2. The three-panel board appears. The board's row 1 / column 1 cell holds the keeper with a `K` badge, and the current-pick outline sits on round 1 pick 2.
3. Type `gibbs`, press Enter — the player lands on the board, leaves the available list, and the pick advances.
4. Enter picks until it is team 4's turn. The center panel switches to **YOUR PICK** with 3 recommendations, each with a reason line.
5. Take a pick. It appears in the left panel's RB1/WR1 slot and the needs list updates.
6. Click **Undo** — the player returns to the pool and the pick indicator steps back.
7. Reload the page — the draft is exactly where you left it.
8. Hover a filled board cell for the tooltip; click a column header for that team's roster popover.
9. Confirm the browser console is clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/board.js src/ui/app.js tests/board.test.js README.md draft.html
git commit -m "feat: add draft board grid and wire the full three-panel app"
```

---

## Self-Review Notes

Spec coverage confirmed against `docs/superpowers/specs/2026-08-23-fantasy-draft-assistant-design.md`:

| Spec section | Task |
|---|---|
| League configuration defaults, roster slots | 3, 7, 9 |
| Single-page client-side, no backend, no deps, `localStorage` | 7, 8 |
| Player data JSON, swappable, ~200-250 players | 1 |
| Setup screen: settings, position selector, teams/keepers, roster slots | 9 |
| Keeper behavior: removed from pool, pre-filled, pick skipped | 7, 9, 12 |
| Left panel: roster slots, positional need tiers | 10 |
| Center: pick info, recommendations, available list, pick entry, undo | 11 |
| Right panel: grid, snake arrows, colors, keeper badge, tooltip, header popover | 12 |
| BPA, positional need, VBD, composite score | 3, 4, 5 |
| Competitive awareness | 6 |
| Data flow, undo, refresh restore | 7, 12 |
| Dark theme, position colors, laptop-only | 8 |

Two deliberate deviations from the spec, both flagged rather than silently made:

1. **Batch entry mode** (spec, center panel) is not a separate mode. The pick box already accepts pick after pick with keyboard focus retained, which covers catching up on missed picks with no extra UI. If a distinct batch paste-a-list flow is wanted, it is a small follow-up task on top of `handlePick`.
2. **VBD replacement level is static**, computed once from the full pool at draft start, per the spec's definition ("the last starter-quality player at each position given league size"). A dynamic recompute against the remaining pool is a one-line change in `renderDraft` if you want it to drift as positions get picked clean.
