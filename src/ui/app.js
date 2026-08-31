import { el, clear, formatFetchedAt } from './dom.js';
import { startTour, closeTour, SETUP_STEPS, DRAFT_STEPS, hasSeenTour, markTourSeen } from './tour.js';
import { renderSetup } from './setup.js';
import { renderMyTeam } from './myteam.js';
import { renderCenter, resetView } from './center.js';
import { renderBoard } from './board.js';
import { renderSummary } from './summary.js';
import { pickToSlot } from '../core/snake.js';
import { positionalNeeds, benchDepthIfAdded } from '../core/roster.js';
import { replacementPoints, withVbd } from '../core/vbd.js';
import { maxPositiveVbd, maxOverallRank } from '../core/recommend.js';
import { competitiveNotes } from '../core/competitive.js';
import { handcuffIdsFor } from '../core/handcuff.js';
import { draftRows, toCsv, csvFilename, CSV_HEADER } from '../core/csv.js';
import { gradeTeams } from '../core/grade.js';
import { buildReport } from '../core/report.js';
import { DEFAULT_CONFIG, createState, currentPickNumber, applyPick, applyOffListPick, undoPick, setPick, availablePlayers, rosterFor, rostersByTeam, myNextPick, myNextPickAfter, saveState, loadState, clearState, playersWithOwners, playersWithPickNumbers, serialize, deserialize, backupFilename, printTitle } from '../core/state.js';

let state = null;
let allPlayers = [];
// Which screen is showing, as one value rather than a flag plus `state === null`.
// The summary replaces the three panels rather than overlaying them: it is a place you go,
// and a draft that is over has nothing behind it worth seeing through a scrim — so a
// re-render has to be told which screen to draw, not guess from two variables that can
// disagree. Anything that drives the app from outside (a guided tour, a test) can ask.
let screen = 'setup';
let replacement = null;
// Fixed for the whole draft, exactly like `replacement` — see recommend().
let vbdScale = 1;
// The BPA denominator, also fixed for the whole draft: a position filter narrows the
// pool recommend() sees, and deriving this from that pool would move the denominator.
let poolSize = 1;
// False once a save has failed, so the user is warned before they trust a refresh.
let storageWorks = true;

function scaleFromReplacement() {
  return maxPositiveVbd(withVbd(allPlayers, replacement));
}

// Baselines depend on numTeams and slots, both of which the setup screen lets the
// user change and an imported draft brings its own copy of, so they must be
// recomputed for the config actually in `state` — never left over from whatever
// config (default, or a previously loaded draft) preceded it.
function recomputeBaselines() {
  replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
  vbdScale = scaleFromReplacement();
}

function persist() {
  storageWorks = saveState(state);
}

function root() {
  return document.getElementById('app');
}

// Shown on all three screens: someone deciding whether to trust these rankings needs
// the answer before they start a draft, during one, and when reading the grades they
// produced.
//
// `wrap` names a class that matches this to the centred card it sits beside — .setup is
// 900px, .summary 620px. Without it the line is `container`'s sibling and right-aligns
// to the browser window instead of the card, which reads as a mistake next to a panel
// that has visibly stopped short of the edge. The draft screen needs no wrapper: there
// the line goes inside the right-hand panel, which is already the right width.
function appendFreshness(container, { wrap = null } = {}) {
  const stamp = formatFetchedAt(window.DATA_FETCHED_AT);
  if (!stamp) return;
  const line = el('div', { class: 'freshness', text: `Player data as of ${stamp}` }, []);
  container.appendChild(wrap ? el('div', { class: wrap }, [line]) : line);
}

// The one place that decides what is on screen. Every handler below re-renders through
// this rather than calling a screen function directly, so `screen` and what the user is
// looking at cannot drift apart.
function render() {
  // A tour describes the screen it was started on. Click-through is deliberate, so
  // the very steps that ring Start Draft and End draft invite the click that changes
  // screens — which would otherwise leave a stale ring at the old button's
  // coordinates and a card counting steps of a screen that is no longer there.
  closeTour();
  if (screen === 'setup') showSetup();
  else if (screen === 'summary') showSummary();
  else renderDraft();
}

function startDraft(config) {
  state = createState(config);
  screen = 'draft';
  recomputeBaselines();
  persist();
  render();
}

function showSetup() {
  screen = 'setup';
  const container = root();
  clear(container);
  // Import lives here as well as on the draft screen. Every catastrophe a backup
  // exists for — wiped storage, another browser, another laptop — lands the user on
  // this screen, where the draft-screen buttons do not exist yet.
  renderSetup(container, (state && state.config) || DEFAULT_CONFIG, startDraft, handleImport, {
    offerTour: !hasSeenTour(),
    // The tour sets the seen flag on close, but `offerTour` was read before it ran —
    // so the line would sit there until the next visit. Re-render once the tour is
    // done, whichever way it ended. Only if setup is still what is on screen: closing
    // the tour by clicking Start Draft through the dim arrives here with `screen`
    // already 'draft', and re-rendering setup would undo the draft the user started.
    onStartTour: () => startTour(SETUP_STEPS, document, () => { if (screen === 'setup') render(); }),
    // Dismissing is a decision, same as skipping: the offer never returns.
    onDismiss: () => { markTourSeen(); render(); },
  });
  appendFreshness(container, { wrap: 'freshness-card' });
}

function showSummary() {
  const rows = gradeTeams(rostersByTeam(state, allPlayers), state.config.slots, state.config.teams);
  // The module-level `replacement`, not a fresh replacementPoints() call: a second
  // computation would silently disagree with the VBD column the moment a config
  // differed, and the blind spot would be measured against a bar the rest of the app
  // is not using.
  const report = buildReport(state, allPlayers, replacement);
  const container = root();
  clear(container);
  // End draft is deliberately unguarded — a league that stops after fourteen rounds is
  // finished, and the app has no business arguing. But the screen must not call that a
  // completed draft: currentPickNumber returns null only when every pick exists.
  const complete = currentPickNumber(state) === null;
  renderSummary(container, {
    rows, myTeamIndex: state.config.myTeamIndex, report, complete,
  }, {
    onBack: () => { screen = 'draft'; render(); },
    // Every real browser defines window.print, so this guard is not a compatibility
    // check — it is what lets the test stub stand in for a host that has none. Hiding
    // the button costs nothing either way, since Ctrl+P still works.
    onPrint: typeof window.print === 'function' ? handlePrint : null,
  });
  // The other two screens both say how fresh the projections are, and this screen is
  // nothing but a ranking derived from them — it needs the caveat more than either.
  appendFreshness(container, { wrap: 'freshness-summary' });
}

function handlePick(playerId) {
  try {
    state = applyPick(state, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  render();
}

// Someone drafted a player who is not in the loaded pool. Burn the slot so every
// later pick still lands on the right pick number and the right team.
function handleOffListPick() {
  try {
    state = applyOffListPick(state);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  render();
}

function handleEditPick(pickNumber, playerId) {
  try {
    state = setPick(state, pickNumber, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  render();
}

function handleUndo() {
  state = undoPick(state);
  persist();
  render();
}

function handleReset() {
  if (!window.confirm('Clear this draft and return to setup?')) return;
  clearState();
  state = null;
  // The centre panel's sort/filter/search is module state and would otherwise
  // survive into the next draft.
  resetView();
  // Through render(), not showSetup() directly: it is render() that closes an open
  // tour, and step 4 rings the panel this very button sits in.
  screen = 'setup';
  render();
}

// Blob and FileReader, not a library: the page ships as one self-contained file and
// takes no dependency, ever.
// Shared by the backup and the CSV export. The revoke timing below took real debugging
// once and must not be reimplemented per caller.
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename }, []);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Deferred, not synchronous: several browsers have not finished reading the blob
  // by the time click() returns, and revoking on the same tick silently produces an
  // empty or failed download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function handleBackup() {
  download(new Blob([serialize(state)], { type: 'application/json' }), backupFilename(state));
}

// One row per pick, which the board's own shape cannot express: the grid hides that
// round 2 runs back the other way, and it has room for a name and nothing else.
function handleExportCsv() {
  const body = toCsv([CSV_HEADER, ...draftRows(state, allPlayers)]);
  // A UTF-8 BOM. Excel on Windows otherwise reads the file as the system codepage and
  // mangles every apostrophe and accent in it — Ja'Marr Chase is the common case here.
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  download(blob, csvFilename(state));
}

function handlePrintBoard() {
  const previous = document.title;
  document.title = printTitle(state, 'board');
  // The board is wide — sixteen teams across — and the report card reads better
  // portrait. @page is document-global and cannot be scoped by a selector, so the
  // orientation is attached for this print only and taken off again afterwards.
  const page = el('style', { text: '@page { size: landscape; }' }, []);
  if (document.head) document.head.appendChild(page);
  try {
    window.print();
  } finally {
    // Same caveat as the title: on engines where print() does not block, this is
    // removed before the dialog reads it and the sheet comes out portrait.
    if (page.parentNode) page.parentNode.removeChild(page);
    document.title = previous;
  }
}

// The browser's print dialog is the export: "Save as PDF" is built into every one of
// them, so this needs no download code and no dependency. The title swap is the whole
// trick — browsers name the saved file after document.title, which is otherwise
// "Draft Assistant" for every league member's report.
function handlePrint() {
  const previous = document.title;
  document.title = printTitle(state);
  try {
    window.print();
  } finally {
    // finally, not a plain assignment after the call. Dismissing the dialog does NOT
    // need this — where print() blocks, the user has already dismissed it by the time
    // the call returns. It is here for the throw: printing can be disabled by policy or
    // by a sandboxed frame, and without it the tab keeps the report's title for the rest
    // of the session, so the next save-as-PDF from any other screen inherits it.
    //
    // Known limitation, untestable here and unfixable without guessing: on engines where
    // print() does NOT block — iOS Safari, some Android WebViews — this restores the
    // title before the print UI has read it, and the file saves as "Draft Assistant.pdf"
    // again. An `afterprint` listener would cover those, but it does not fire reliably
    // in the same engines, and relying on it would trade a wrong filename on mobile for
    // a permanently wrong tab title on desktop. The desktop path is the one that works;
    // this is recorded rather than papered over.
    document.title = previous;
  }
}

// Exported for the tests: everything about an import except reading the bytes, which
// is the one part a FileReader makes untestable.
export function applyRestoredState(restored) {
  state = restored;
  recomputeBaselines();
  // The centre panel's sort, filter and position targeting are module state that
  // outlives a draft. Without this an imported draft inherits the last one's targeting.
  resetView();
  // An import lands on the draft, never on whatever screen preceded it.
  screen = 'draft';
  // Render BEFORE persisting. A state that cannot render must not reach localStorage:
  // it would then throw on every subsequent load, before any UI exists — including
  // the Reset button — and only devtools could recover the page.
  render();
  persist();
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let restored;
    try {
      restored = deserialize(String(reader.result));
    } catch (err) {
      window.alert(`That file is not a saved draft.\n\n${err.message}`);
      return;
    }
    if (!window.confirm('Replace the current draft with this backup?')) return;
    applyRestoredState(restored);
  };
  reader.readAsText(file);
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
  // Every player, drafted or not, for the table. `pool` stays available-only so the
  // recommendation path structurally cannot see a drafted player.
  const tablePlayers = withVbd(playersWithOwners(state, allPlayers), replacement);
  const myRoster = rosterFor(state, config.myTeamIndex, allPlayers);
  const needs = positionalNeeds(myRoster, config.slots, round, config.rounds);
  // How deep the bench would get at each position if this pick went there.
  const surplus = benchDepthIfAdded(myRoster, config.slots);
  // The backups to the players currently in your starting lineup — empty until you
  // have one, which is why the filter it feeds does nothing in round one.
  const handcuffIds = handcuffIdsFor(myRoster, config.slots);
  const nextPick = myNextPick(state);
  // The selection after this one — what the competitive window is measured over,
  // and what the header shows when it is already your turn.
  const nextAfterCurrent = currentPick === null ? null : myNextPickAfter(state, currentPick);

  const notes = isMyPick
    ? competitiveNotes({
      currentPick,
      nextPick: nextAfterCurrent,
      numTeams: config.numTeams,
      rounds: config.rounds,
      rostersByTeam: rostersByTeam(state, allPlayers),
      slots: config.slots,
      pool,
      replacement,
    })
    : [];

  clear(container);
  const left = el('div', { class: 'panel left' }, []);
  const center = el('div', { class: 'panel center' }, []);
  const right = el('div', { class: 'panel right' }, []);

  // localStorage can be unavailable or throw (Safari on file://, blocked site data,
  // quota). Saving then silently no-ops, and the user only finds out when a refresh
  // loses the draft — so say so, on every render, until it works again.
  if (!storageWorks) {
    container.appendChild(el('div', {
      class: 'notes',
      text: 'Draft is NOT being saved — do not refresh this page. '
        + 'Browser storage is unavailable (private window, blocked site data, or full).',
    }, []));
  }

  container.appendChild(el('div', { class: 'layout' }, [left, center, right]));

  renderMyTeam(left, {
    roster: myRoster,
    slots: config.slots,
    round,
    totalRounds: config.rounds,
    teamName: config.teams[config.myTeamIndex - 1].name,
  });
  // Each of these carries a class as well as its label. They are otherwise
  // distinguishable only by their text, which anything anchoring to one of them — a
  // guided tour, a test — would then have to match on a string.
  left.appendChild(el('button', {
    class: 'btn-reset', text: 'Reset draft', style: { marginTop: '12px' }, onClick: handleReset,
  }, []));
  left.appendChild(el('button', {
    class: 'btn-end-draft', text: 'End draft', style: { marginTop: '8px' },
    onClick: () => { screen = 'summary'; render(); },
  }, []));
  left.appendChild(el('button', { class: 'btn-backup', text: 'Save backup', style: { marginTop: '8px' }, onClick: handleBackup }, []));
  const importInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onChange: (e) => {
      const file = e.target.files && e.target.files[0];
      // Clear the control before handing the file off. A file input fires `change`
      // only when the selection *changes*, so declining the confirm and re-picking
      // the same file would otherwise do nothing at all and look broken.
      e.target.value = '';
      if (file) handleImport(file);
    },
  }, []);
  left.appendChild(el('button', { class: 'btn-import', text: 'Import backup', style: { marginTop: '8px' }, onClick: () => importInput.click() }, []));
  left.appendChild(importInput);
  left.appendChild(el('button', {
    class: 'btn-tour', text: 'Show me around', style: { marginTop: '8px' },
    onClick: () => startTour(DRAFT_STEPS),
  }, []));

  renderCenter(center, {
    pool,
    tablePlayers,
    myRoster,
    slots: config.slots,
    handcuffIds,
    needs,
    surplus,
    currentPick,
    nextPick: isMyPick ? nextAfterCurrent : nextPick,
    round,
    numTeams: config.numTeams,
    isMyPick,
    pickingTeamName: pickingTeam ? config.teams[pickingTeam - 1].name : '',
    notes,
    vbdScale,
    poolSize,
  }, { onPick: handlePick, onUndo: handleUndo, onOffList: handleOffListPick });

  // Keyed by teamIndex for the board; the same rows, sorted, feed the summary.
  const gradeRows = gradeTeams(rostersByTeam(state, allPlayers), config.slots, config.teams);
  const grades = new Map(gradeRows.map((r) => [r.teamIndex, r]));

  renderBoard(right, {
    state,
    allPlayers,
    grades,
    // Drafted players included, each tagged with the pick holding him: choosing one
    // exchanges the two picks, which is the only way to fix a transposed pair.
    editablePool: playersWithPickNumbers(state, allPlayers),
    onEditPick: handleEditPick,
  });

  // Under the board, not in the left panel with the other buttons: these two export the
  // board specifically, and a control belongs beside the thing it acts on.
  const exports = el('div', { class: 'board-exports' }, [
    el('button', { class: 'btn-csv', text: 'Export CSV', onClick: handleExportCsv }, []),
    typeof window.print === 'function'
      ? el('button', { class: 'btn-print', text: 'Print / Save as PDF', onClick: handlePrintBoard }, [])
      : null,
  ]);
  right.appendChild(exports);

  // Inside the right-hand panel, not after `.layout`: `.layout` is `height: 100vh`
  // with no page scroll by design (the centre panel owns its own internal scroll so
  // the pick controls never leave the viewport — see the comments on `.panel.center`
  // in styles.css). A sibling of `.layout` lands at y ≈ 100vh, invisible without
  // scrolling and reintroducing exactly the page-level scrollbar that design avoids.
  // The right panel already has `overflow: auto`, so the line scrolls into view with
  // the board it sits under instead.
  appendFreshness(right);
}

export function init() {
  allPlayers = window.PLAYERS || [];
  // Depends only on the shipped pool, so unlike vbdScale it never needs recomputing
  // when the league config changes.
  poolSize = maxOverallRank(allPlayers);
  replacement = replacementPoints(allPlayers, DEFAULT_CONFIG.numTeams, DEFAULT_CONFIG.slots);
  vbdScale = scaleFromReplacement();

  const saved = loadState();
  if (!saved) {
    showSetup();
    return;
  }

  // A stored state that throws during render used to leave a dead page: nothing at
  // all rendered, on this load and on every one after it, so not even Reset was
  // reachable. Falling back to setup costs the draft but never the app.
  try {
    state = saved;
    // A load always opens the draft: `screen` is module state that outlives a draft, and
    // a previous run left on the summary must not decide what a fresh load shows.
    screen = 'draft';
    recomputeBaselines();
    render();
  } catch (err) {
    clearState();
    state = null;
    window.alert(`The saved draft could not be opened and has been discarded.\n\n${err.message}`);
    showSetup();
  }
}

// The built page has no bundler and no entry hook: evaluating this module IS the
// start signal, so the call has to stay at module scope. Under `node --test` there
// is a `process`, and the test must install its DOM stub and fixtures before
// anything renders — so it is skipped there and the test calls init() itself.
if (typeof process === 'undefined') init();
