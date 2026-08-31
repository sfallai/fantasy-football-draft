import { el, clear, POSITION_COLORS, abbreviate } from './dom.js';
import { slotToPick } from '../core/snake.js';
import { assignSlots, positionalNeeds } from '../core/roster.js';
import { currentPickNumber, rosterFor, isOffListId } from '../core/state.js';
import { slotRow } from './slotrow.js';
import { showPopover, closePopover } from './popover.js';
import { pickEditor } from './pickeditor.js';

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
        isOffList: Boolean(entry && isOffListId(entry.playerId)),
        isKeeper: Boolean(entry && entry.isKeeper),
        isMine: teamIndex === myTeamIndex,
        isCurrent: pick === current,
      });
    }
    grid.push(row);
  }
  return grid;
}

function showRosterPopover(event, state, allPlayers, teamIndex, row) {
  closePopover();
  const { slots, rounds } = state.config;
  const roster = rosterFor(state, teamIndex, allPlayers);
  const round = Math.min(rounds, Math.floor(roster.length) + 1);
  const needs = positionalNeeds(roster, slots, round, rounds);
  // rosterFor drops every pick it cannot resolve to a player — off-list picks, and any
  // id no longer in the pool. Without a word here the team simply shows fewer picks
  // than it has made, and is graded as though the slot were empty, which reads as a bug
  // rather than as the deliberate "a player with no projection scores zero".
  const uncounted = Object.keys(state.picks)
    .filter((pick) => state.picks[pick].teamIndex === teamIndex).length - roster.length;

  const pop = el('div', { class: 'roster-pop' }, [
    el('div', { style: { fontWeight: '600', marginBottom: '6px' }, text: state.config.teams[teamIndex - 1].name }, []),
    ...assignSlots(roster, slots).map((slot) => slotRow(slot)),
    el('div', { style: { marginTop: '6px', color: '#8b93a5' }, text: 'Needs' }, []),
    ...Object.keys(needs).map((pos) => el('div', { class: 'need-row' }, [
      el('span', { text: pos, style: { color: POSITION_COLORS[pos] } }, []),
      el('span', { class: `tier tier-${needs[pos]}`, text: needs[pos] }, []),
    ])),
    el('div', { style: { marginTop: '8px', color: '#8b93a5' }, text: 'Picks' }, []),
    // In pick order, which is what rosterFor returns — the slot layout above already
    // answers "who starts", so this answers the different question of what they took.
    ...roster.map((pl) => el('div', { class: 'pop-pick' }, [
      el('span', { style: { color: POSITION_COLORS[pl.position] }, text: pl.position }, []),
      el('span', { class: 'pop-pick-name', text: pl.name }, []),
      el('span', { class: 'meta', text: String(pl.projectedPoints) }, []),
    ])),
    uncounted > 0 ? el('div', {
      class: 'pop-offlist',
      text: `${uncounted} off-list pick${uncounted === 1 ? '' : 's'} not counted`,
    }, []) : null,
    row ? el('div', { class: 'pop-grade' }, [
      el('span', { text: `Grade ${row.grade}` }, []),
      el('span', { class: 'meta', text: `${row.strength} projected starter pts` }, []),
    ]) : null,
  ]);

  showPopover(pop, event);
}

export function renderBoard(container, ctx) {
  const { state, allPlayers } = ctx;
  const { numTeams, teams, myTeamIndex } = state.config;
  clear(container);
  closePopover();

  container.appendChild(el('h2', { text: 'Draft Board' }, []));

  const headerCells = [el('th', { class: 'rnd', text: 'R' }, [])];
  for (let teamIndex = 1; teamIndex <= numTeams; teamIndex += 1) {
    const row = ctx.grades ? ctx.grades.get(teamIndex) : null;
    // Two child elements rather than one `text:` plus a child: el() applies `text`
    // before appending children, so both would in fact work — but the name and the
    // grade are two separately styled lines (.team-grade is smaller and accented), and
    // only a header built entirely from children can style each of them.
    headerCells.push(el('th', {
      class: teamIndex === myTeamIndex ? 'mine' : '',
      title: `Click for ${teams[teamIndex - 1].name}'s roster, needs and grade`,
      onClick: (e) => showRosterPopover(e, state, allPlayers, teamIndex, row),
    }, [
      el('div', { text: teams[teamIndex - 1].name }, []),
      row ? el('div', { class: 'team-grade', text: row.grade }, []) : null,
    ]));
  }

  const rows = boardCells(state, allPlayers).map((row, i) => {
    const round = i + 1;
    // Odd rounds run left to right, even rounds right to left.
    const arrow = round % 2 === 1 ? '→' : '←';
    const cells = [el('td', { class: 'rnd', text: `${round}${arrow}` }, [])];

    for (const cell of row) {
      // Only a filled cell is editable, and only a filled cell may advertise it:
      // `cursor: pointer` on all 150 is a false affordance on the ~145 that early
      // in a draft have no handler at all.
      const isFilled = Boolean(cell.player || cell.isOffList);
      const classes = ['cell'];
      if (isFilled) classes.push('filled');
      if (cell.isMine) classes.push('mine-col');
      if (cell.isCurrent) classes.push('current');
      if (cell.isKeeper) classes.push('keeper');

      // An off-list pick has no player to name, but it must not look like an
      // unfilled cell — that slot is spent.
      const offListText = cell.isOffList ? '—' : '';
      const offListTitle = cell.isOffList
        ? `Pick ${cell.pick} — off-list pick (player not in the loaded pool)`
        : `Pick ${cell.pick}`;

      cells.push(el('td', {
        class: classes.join(' '),
        text: cell.player ? abbreviate(cell.player.name) : offListText,
        style: cell.player ? { color: POSITION_COLORS[cell.player.position] } : {},
        title: cell.player
          ? `${cell.player.name} — ${cell.player.position} ${cell.player.team}\n`
            + `#${cell.player.overallRank} overall · ${cell.player.projectedPoints} proj · `
            + `ADP ${cell.player.adp ?? '—'} · bye ${cell.player.bye ?? '—'}`
          : offListTitle,
        onClick: isFilled
          ? (e) => {
            showPopover(pickEditor(cell, ctx.editablePool, (playerId) => {
              closePopover();
              ctx.onEditPick(cell.pick, playerId);
            }), e);
          }
          : null,
      }, []));
    }

    return el('tr', {}, cells);
  });

  container.appendChild(el('table', { class: 'board' }, [
    el('thead', {}, [el('tr', {}, headerCells)]),
    el('tbody', {}, rows),
  ]));
}
