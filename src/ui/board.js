import { el, clear, POSITION_COLORS, abbreviate } from './dom.js';
import { slotToPick } from '../core/snake.js';
import { assignSlots, positionalNeeds } from '../core/roster.js';
import { currentPickNumber, rosterFor, isOffListId } from '../core/state.js';
import { slotRow } from './slotrow.js';
import { showPopover, closePopover } from './popover.js';

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

function showRosterPopover(event, state, allPlayers, teamIndex) {
  closePopover();
  const { slots, rounds } = state.config;
  const roster = rosterFor(state, teamIndex, allPlayers);
  const round = Math.min(rounds, Math.floor(roster.length) + 1);
  const needs = positionalNeeds(roster, slots, round, rounds);

  const pop = el('div', { class: 'roster-pop' }, [
    el('div', { style: { fontWeight: '600', marginBottom: '6px' }, text: state.config.teams[teamIndex - 1].name }, []),
    ...assignSlots(roster, slots).map((slot) => slotRow(slot)),
    el('div', { style: { marginTop: '6px', color: '#8b93a5' }, text: 'Needs' }, []),
    ...Object.keys(needs).map((pos) => el('div', { class: 'need-row' }, [
      el('span', { text: pos, style: { color: POSITION_COLORS[pos] } }, []),
      el('span', { class: `tier tier-${needs[pos]}`, text: needs[pos] }, []),
    ])),
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
      }, []));
    }

    return el('tr', {}, cells);
  });

  container.appendChild(el('table', { class: 'board' }, [
    el('thead', {}, [el('tr', {}, headerCells)]),
    el('tbody', {}, rows),
  ]));
}
