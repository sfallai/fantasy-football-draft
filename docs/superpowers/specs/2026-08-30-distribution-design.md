# Distribution — Design Spec

## Overview

The draft assistant is to be used by roughly a dozen people the author knows, none
of them technical. Today it exists only as a file on one laptop, in a git repo with
no remote. This spec covers getting it in front of those people and keeping it
current without anyone opening a terminal.

**Recorded 2026-08-30.** Supersedes chunk G of
`2026-08-29-post-draft-improvements-design.md`.

## The decisions this rests on

| Question | Answer |
|---|---|
| How do people get it? | A hosted URL they bookmark |
| Who is it for? | About a dozen people the author knows |
| When it breaks on draft morning? | They text the author, who fixes it |
| Must it work with no internet? | No — assume a connection |
| Public repo? | Yes |

The last two are what make this small. An offline-capable hosted app needs a
service worker and a cache-invalidation story, and buys nothing the author asked
for. A private repo would need a second hosting service. Neither earns its cost
here.

## What hosting dissolves

Three problems the previous design worked around stop existing:

- **The CORS block.** Fantasy Football Calculator sends no CORS headers, which is
  why an in-page ADP refresh was impossible from a `file://` page. Serving the app
  from an origin the author controls means the data is same-origin. No proxy, no
  AWS Lambda, no null-origin preflight.
- **Staleness.** A distributed file goes stale the moment it is sent. A hosted page
  rebuilt on a schedule is already current when someone opens it on draft morning —
  strictly better than a refresh button they would have to know to press.
- **Being unable to push a fix.** The property that made a distributed file
  genuinely risky for non-technical users: a broken upstream stranded everyone with
  no recourse but redistributing a file. A fix now reaches everyone on their next
  load.

The terminal requirement does not vanish; it moves to the author, who can use one.
The scheduled rebuild then removes it from the author too.

## Architecture

**Repository.** The local repo gains a `origin` remote on GitHub, public. There are
no secrets to leak: ESPN and Fantasy Football Calculator are both read without
authentication, and the codebase has no keys.

**Serving.** GitHub Pages, from `main` at the repository root. Committing is
deploying — there is no separate deploy step to fail.

**The URL.** Pages serves a directory, and the built artifact is `draft.html`, so
the bare URL would end `/draft.html`. A three-line `index.html` at the repository
root redirects to it. This is preferred over renaming the build output, which would
churn the README, `tests/build.test.js`, and the author's habit of opening
`draft.html` directly while working. The address takes the form
`https://<account>.github.io/fantasy-football-draft/`; the account name is supplied
when the remote is created.

**Freshness.** `.github/workflows/refresh.yml`, running **daily at 11:00 UTC** and
on manual dispatch:

1. `npm run fetch`
2. `npm test`
3. `npm run build`
4. Commit, only if all three succeeded and something changed.

Daily rather than seasonal: ADP moves constantly through preseason, the job takes
about two minutes, and a conditional commit keeps the history honest. Manual dispatch
matters separately — it gives the author a **Run workflow** button in the GitHub web
UI, so a draft-morning refresh needs no laptop and no terminal.

## The test gate is the safety, not a formality

If ESPN changes a response shape, `npm run fetch` may still succeed while producing
data that is subtly wrong. Chunk A's tripwires exist for exactly this — age coverage
below 80%, prior-season coverage below 50%, zero rookies in the pool, a game count
above 17 — and any of them fails the workflow.

A failed workflow **does not deploy**. The site keeps serving the last known-good
build and the author gets an email. Stale rankings beat wrong rankings, and the
failure surfaces weeks before draft day rather than on the morning.

## Showing the user how fresh the data is

This is what remains of the refresh button, and it is a fraction of the work.

`tests/build.test.js` asserts that the committed `draft.html` is byte-identical to a
fresh in-process rebuild. **A timestamp read from the clock at build time would break
that immediately** — two builds of identical source would differ. So the stamp must
come from data, not from the clock:

- `scripts/fetch-players.mjs` writes `data/fetched-at.json` — a single ISO-8601
  timestamp under one key — alongside the player data.
- `scripts/build.mjs` inlines it.
- The page shows *"Player data as of 29 Aug"*.

It records **when the data was last successfully checked**, not when it last changed.
Those differ, and checked is the more useful of the two: a user wants to know whether
the rankings are current, and data that was verified unchanged this morning is
current. Recording last-changed would show an alarming old date on data that is
perfectly fresh.

The consequence is that this file changes on every successful run, so the workflow
commits daily even when no player moved. That is one line of churn a day in a
single-author repository, and it buys a date the page can state truthfully.
`players.json` still changes only when the data does.

Rebuilding from unchanged data therefore reproduces identical bytes, and the
byte-equality invariant survives. A separate small file is used rather than a field
inside `players.json` because every consumer of that file expects a bare array.

## Out of scope

- **Onboarding.** A guided tour of the setup and draft screens was agreed separately
  and is chunk H of the backlog spec. It is a feature in the app, not infrastructure,
  and hosting should not wait for it.
- **Offline capability.** Explicitly declined. Once loaded the page keeps working if
  a connection drops mid-draft; it simply cannot be loaded cold without one.
- **Phones.** A dozen known people drafting on laptops. If that changes it is a
  separate design, not a hedge to build now.
- **Analytics, accounts, sharing a draft between devices.** None were asked for. The
  draft still lives in one browser's `localStorage`, and a backup file is how it
  moves — which the author has now confirmed works.

## Risks

**The cron commits to `main`.** Acceptable for a single-author repository, and the
test gate means it can only commit data that validates.

**Moving from `file://` to `https://` orphans existing saved drafts.** `localStorage`
is per-origin. Irrelevant today — no draft is in progress — but worth knowing before
the switch happens mid-season one year.

**GitHub Pages is a dependency the app did not previously have.** If it is down on
draft morning, nobody can load the page. Mitigated by the data staying baked into
`draft.html`: anyone who has the page open keeps drafting, and the author can send
the file directly as a fallback, exactly as before. That is why the 400-player file
stays inlined rather than being fetched separately.

## Testing

- A test asserting the root `index.html` exists and points at `draft.html`.
- A test asserting the freshness stamp is present in the bundle and parses as a date.
- The workflow itself cannot be unit-tested. Its protection is the `npm test` gate it
  runs, which is already covered.
