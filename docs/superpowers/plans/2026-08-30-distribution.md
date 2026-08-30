# Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the draft assistant at a URL a dozen non-technical people can bookmark, keep its data current without anyone opening a terminal, and show them how fresh that data is.

**Architecture:** The repo gets a public GitHub remote; Pages serves `main` at the root, so committing is deploying. A daily Actions workflow runs fetch → build → test and commits only if the suite passes, so bad upstream data cannot ship. A freshness stamp derived from the data — never from the clock — is inlined at build time and rendered on both screens.

**Tech Stack:** Node 22+, `node:test`, GitHub Actions, GitHub Pages. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-distribution-design.md`

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently.
- **`draft.html` is a build artifact.** Never hand-edit. `tests/build.test.js` rebuilds in-process and asserts byte equality, so any `src/` change needs `npm run build` before the suite is green.
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: a violation silently breaks the built page rather than failing the build.
- **The freshness stamp must come from data, not from the clock.** A build-time timestamp would make two builds of identical source differ, breaking the byte-equality test on the first rebuild.
- **The repo is public and holds no secrets.** ESPN and Fantasy Football Calculator are read without authentication.
- **The workflow needs no PAT.** Actions injects `GITHUB_TOKEN`; the job declares `permissions: contents: write`.

---

### Task 1: Record and format when the data was fetched

**Files:**
- Modify: `scripts/fetch-players.mjs`
- Modify: `src/ui/dom.js`
- Test: `tests/players-data.test.js`, `tests/dom.test.js` (new)

**Interfaces:**
- Produces:
  - `fetchedAtPayload(date) -> { fetchedAt: string }` (exported from `scripts/fetch-players.mjs`) — an ISO-8601 timestamp under one key.
  - `formatFetchedAt(iso) -> string | null` (exported from `src/ui/dom.js`) — `"29 Aug"`, or `null` for a missing or unparseable value.

- [ ] **Step 1: Write the failing tests**

Add to `tests/players-data.test.js`, extending its existing import with `fetchedAtPayload`:

```js
test('fetchedAtPayload records the moment of the fetch as ISO-8601', () => {
  const payload = fetchedAtPayload(new Date('2026-08-30T11:00:00.000Z'));
  assert.deepEqual(payload, { fetchedAt: '2026-08-30T11:00:00.000Z' });
});
```

Create `tests/dom.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFetchedAt } from '../src/ui/dom.js';

test('formatFetchedAt renders a short, unambiguous date', () => {
  assert.equal(formatFetchedAt('2026-08-30T11:00:00.000Z'), '30 Aug');
  assert.equal(formatFetchedAt('2026-01-05T00:00:00.000Z'), '5 Jan');
});

test('formatFetchedAt reads the date in UTC, not the local zone', () => {
  // Otherwise the same build shows a different date to two people, and the test
  // passes or fails depending on where it runs.
  assert.equal(formatFetchedAt('2026-08-30T23:30:00.000Z'), '30 Aug');
  assert.equal(formatFetchedAt('2026-08-30T00:30:00.000Z'), '30 Aug');
});

test('formatFetchedAt is null when there is nothing to show', () => {
  // A fresh clone has never run a fetch. The line is omitted rather than
  // rendering "as of Invalid Date".
  assert.equal(formatFetchedAt(null), null);
  assert.equal(formatFetchedAt(undefined), null);
  assert.equal(formatFetchedAt(''), null);
  assert.equal(formatFetchedAt('not a date'), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dom.test.js tests/players-data.test.js`
Expected: FAIL — neither `formatFetchedAt` nor `fetchedAtPayload` is exported.

- [ ] **Step 3: Implement**

In `scripts/fetch-players.mjs`:

```js
// A separate file rather than a field inside players.json: every consumer of that
// file expects a bare array, and widening it would touch all of them.
export function fetchedAtPayload(date) {
  return { fetchedAt: date.toISOString() };
}
```

and in `main()`, after the existing `writeFileSync` for the player data:

```js
  const stampPath = fileURLToPath(new URL('../data/fetched-at.json', import.meta.url));
  writeFileSync(stampPath, JSON.stringify(fetchedAtPayload(new Date()), null, 0) + '\n');
```

In `src/ui/dom.js`:

```js
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// UTC, deliberately: the stamp is baked into the page at build time, so reading it in
// the local zone would show two people different dates for the same build.
export function formatFetchedAt(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/dom.test.js tests/players-data.test.js` → PASS. Then `npm test` — only `tests/build.test.js`'s freshness check may fail, since `src/` changed without a rebuild.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-players.mjs src/ui/dom.js tests/dom.test.js tests/players-data.test.js
git commit -m "feat: record when player data was fetched, and format it for display"
```

---

### Task 2: Inline the stamp and show it on both screens

**Files:**
- Modify: `scripts/build.mjs`, `src/ui/app.js`, `src/styles.css`
- Test: `tests/build.test.js`, `tests/render-app.test.js`

**Interfaces:**
- Consumes: `formatFetchedAt` (Task 1).
- Produces: `bundle({ srcDir, entry, players, css, html, fetchedAt })` — `fetchedAt` is optional and defaults to `null`. The built page sets `window.DATA_FETCHED_AT`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/build.test.js`:

```js
test('bundle inlines the fetched-at stamp beside the player data', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const out = bundle({
    srcDir, entry: 'ui/app.js', players: [{ id: '1', name: 'A' }],
    css: '', html: 'X/*<!--STYLES-->*/Y/*<!--DATA-->*/Z/*<!--SCRIPT-->*/W',
    fetchedAt: '2026-08-30T11:00:00.000Z',
  });
  assert.ok(out.includes('window.DATA_FETCHED_AT = "2026-08-30T11:00:00.000Z";'));
});

test('bundle omits the stamp rather than writing undefined', () => {
  // A fresh clone has no data/fetched-at.json. The page must still build.
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const out = bundle({
    srcDir, entry: 'ui/app.js', players: [{ id: '1', name: 'A' }],
    css: '', html: 'X/*<!--STYLES-->*/Y/*<!--DATA-->*/Z/*<!--SCRIPT-->*/W',
  });
  assert.ok(out.includes('window.DATA_FETCHED_AT = null;'));
  assert.doesNotMatch(out, /undefined/);
});
```

Add to `tests/render-app.test.js`:

```js
test('the page says how fresh its player data is', () => {
  window.DATA_FETCHED_AT = '2026-08-30T11:00:00.000Z';
  init();
  const line = find(document.body, (n) => n.className === 'freshness')[0];
  assert.ok(line, 'the stamp renders');
  assert.match(line.textContent, /30 Aug/);
});

test('a page built without a stamp shows no freshness line at all', () => {
  // Better silence than "Player data as of Invalid Date".
  window.DATA_FETCHED_AT = null;
  init();
  assert.equal(find(document.body, (n) => n.className === 'freshness').length, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/build.test.js tests/render-app.test.js`
Expected: FAIL — `window.DATA_FETCHED_AT` is never written, and no `.freshness` node exists.

- [ ] **Step 3: Implement**

In `scripts/build.mjs`, change `bundle`'s signature to accept `fetchedAt = null` and extend the one-line data script:

```js
  const dataScript = `window.PLAYERS = ${JSON.stringify(players)};`
    + `window.DATA_FETCHED_AT = ${JSON.stringify(fetchedAt)};`;
```

In `main()`, read the stamp if it exists:

```js
  // A fresh clone has never fetched. Build anyway; the page simply omits the line.
  let fetchedAt = null;
  const stampPath = join(ROOT, 'data', 'fetched-at.json');
  if (existsSync(stampPath)) fetchedAt = JSON.parse(readFileSync(stampPath, 'utf8')).fetchedAt;
```

and pass `fetchedAt` into the `bundle(...)` call. Add `existsSync` to the existing single-line `node:fs` import.

In `src/ui/app.js`, add `formatFetchedAt` to the existing single-line import from `./dom.js`, and add:

```js
// Shown on both screens: someone deciding whether to trust these rankings needs the
// answer before they start a draft, not only during one.
function appendFreshness(container) {
  const stamp = formatFetchedAt(window.DATA_FETCHED_AT);
  if (!stamp) return;
  container.appendChild(el('div', { class: 'freshness', text: `Player data as of ${stamp}` }, []));
}
```

Call `appendFreshness(container)` at the end of both `showSetup` and `renderDraft`.

In `src/styles.css`:

```css
.freshness { color: var(--muted); font-size: 11px; padding: 6px 12px; text-align: right; }
```

- [ ] **Step 4: Verify**

Run: `npm test` — only the build-freshness check may fail. Then `npm run build`, then `npm test` again: **0 failures**.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.mjs src/ui/app.js src/styles.css tests/build.test.js tests/render-app.test.js draft.html
git commit -m "feat: show how fresh the player data is, on both screens"
```

---

### Task 3: A clean URL

GitHub Pages serves a directory. Without this the address ends `/draft.html`, which is a worse thing to send to twelve people than a bare URL.

**Files:**
- Create: `index.html`
- Test: `tests/build.test.js`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

```js
test('the repository root redirects to the built page', () => {
  // GitHub Pages serves a directory; without this the shared URL ends /draft.html.
  const root = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(root, /url=draft\.html/);
  assert.match(root, /<a href="draft\.html"/, 'and a link, for anyone the redirect fails for');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/build.test.js`
Expected: FAIL — `ENOENT`, no `index.html` at the root.

- [ ] **Step 3: Create it**

```html
<!doctype html>
<meta charset="utf-8">
<title>Draft Assistant</title>
<meta http-equiv="refresh" content="0; url=draft.html">
<p><a href="draft.html">Open the Draft Assistant</a></p>
```

The link is the fallback: a meta refresh is not universally honoured, and a blank page with no way forward is the worst outcome for the audience this is for.

- [ ] **Step 4: Verify**

Run: `npm test` — 0 failures. (No `src/` change, so the build stays fresh.)

- [ ] **Step 5: Commit**

```bash
git add index.html tests/build.test.js
git commit -m "feat: redirect the site root to the draft page"
```

---

### Task 4: The daily refresh workflow

**Files:**
- Create: `.github/workflows/refresh.yml`

**Interfaces:** none.

**The step order differs from the README's, deliberately.** The README says fetch → test → build, because that stops a human baking unvalidated data into a page they might then open. In CI the protection is different: nothing is committed unless the suite passes, so building *before* testing is safe — and it is also **necessary**, because `tests/build.test.js` asserts `draft.html` matches a fresh build of the current data. Running the suite between a fetch and a rebuild would fail on that check every single day.

- [ ] **Step 1: Create the workflow**

```yaml
name: Refresh player data

on:
  schedule:
    # 11:00 UTC daily. ADP moves through preseason, the job takes about two minutes,
    # and the commit is conditional, so quiet days cost nothing.
    - cron: '0 11 * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Fetch fresh player data
        run: npm run fetch

      # Before the tests, not after: build.test.js asserts draft.html matches a fresh
      # build of the committed data, so testing between a fetch and a rebuild would
      # fail every run. Nothing ships unless the suite passes below.
      - name: Rebuild the page
        run: npm run build

      # The gate. Chunk A's tripwires — age coverage, prior-season coverage, rookies
      # present, no impossible game counts — fail here if upstream changed shape.
      # A failure means no commit, so the site keeps serving the last good build.
      - name: Validate before anything ships
        run: npm test

      - name: Commit if anything changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/players.json data/fetched-at.json draft.html
          # An explicit if, not `git diff --quiet && ...`. Actions runs `bash -e`, and
          # that command exits 1 precisely when there ARE changes — as the last command
          # of an && list that aborts the step on the days the job matters most.
          if git diff --staged --quiet; then
            echo "no change to commit"
          else
            git commit -m "chore(data): daily refresh"
            git push
          fi
```

- [ ] **Step 2: Verify it parses as YAML**

```bash
node -e '
const t = require("fs").readFileSync(".github/workflows/refresh.yml","utf8");
for (const k of ["schedule","workflow_dispatch","contents: write","npm run fetch","npm run build","npm test"])
  console.log(k + ":", t.includes(k));
console.log("build precedes test:", t.indexOf("npm run build") < t.indexOf("npm test"));
'
```

Expected: every line `true`. (The workflow cannot be executed locally; its real proof is Task 5's manual run.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh.yml
git commit -m "ci: refresh player data daily, gated on the test suite"
```

---

### Task 5: Publish

**This task is outward-facing and creates a public repository under the user's name. Do not begin it without explicit confirmation that the account is correct.** `gh auth status` shows two authenticated accounts; the active one is `sfallai`, which produces `https://sfallai.github.io/fantasy-football-draft/`.

**Files:** none in the repo.

- [ ] **Step 1: Prove the pipeline locally before it runs unattended**

```bash
npm run fetch && npm run build && npm test
```

Expected: the fetch prints its counts, the build writes `draft.html`, and the suite passes with 0 failures. This is exactly the sequence CI runs; if it fails here it would fail there.

- [ ] **Step 2: Commit the refreshed data**

```bash
git add data/players.json data/fetched-at.json draft.html
git commit -m "chore(data): refresh, and stamp when it was fetched"
```

- [ ] **Step 3: Create the repository and push**

```bash
gh repo create fantasy-football-draft --public --source=. --remote=origin --push
```

- [ ] **Step 4: Enable Pages**

```bash
gh api -X POST repos/sfallai/fantasy-football-draft/pages \
  -f 'source[branch]=main' -f 'source[path]=/' 2>&1 | head -5
```

Then confirm:

```bash
gh api repos/sfallai/fantasy-football-draft/pages --jq '"status: \(.status)  url: \(.html_url)"'
```

Pages takes a minute or two to build the first time. A `status` of `building` is expected initially; re-run until it reads `built`.

- [ ] **Step 5: Verify the live site actually serves the app**

```bash
curl -sS -o /tmp/live.html -w '  http %{http_code}  %{size_download} bytes\n' \
  https://sfallai.github.io/fantasy-football-draft/draft.html
node -e '
const h = require("fs").readFileSync("/tmp/live.html","utf8");
const local = require("fs").readFileSync("draft.html","utf8");
console.log("  live page matches the committed build:", h === local);
console.log("  carries the freshness stamp:", /window\.DATA_FETCHED_AT = "/.test(h));
'
```

Expected: HTTP 200, the byte comparison `true`, and the stamp present. If the root URL 404s while `/draft.html` works, Pages has not finished building — wait and retry.

- [ ] **Step 6: Trigger the workflow by hand, and watch it**

```bash
gh workflow run "Refresh player data"
sleep 20 && gh run list --workflow "Refresh player data" --limit 1
```

Then `gh run watch` on the id it prints. A green run proves the unattended path works — which is the whole point of the chunk, and the one thing that cannot be tested any other way.

- [ ] **Step 7: Record the URL in the README**

Replace the README's opening — currently written for a developer with a terminal — so the first thing a reader sees is the link, with the developer instructions kept below under their own heading.

```bash
git add README.md && git commit -m "docs: lead with the URL, not the build instructions"
```

---

## Verification

Distribution is done when:

- `npm test` passes with more tests than the 293 this chunk started from.
- `https://sfallai.github.io/fantasy-football-draft/` serves the app, and the page shows *"Player data as of …"* on both the setup and draft screens.
- A manually triggered **Refresh player data** run completes green and, if the data moved, commits.
- The README leads with the URL.
