import { el, clear } from './dom.js';

export function renderSummary(container, ctx, handlers) {
  clear(container);
  const { rows, myTeamIndex } = ctx;

  const rowNodes = rows.map((r) => el('div', {
    class: r.teamIndex === myTeamIndex ? 'sum-row mine' : 'sum-row',
  }, [
    el('span', { class: 'sum-rank', text: String(r.rank) }, []),
    el('span', { class: 'sum-name', text: r.name }, []),
    el('span', { class: 'sum-grade', text: r.grade }, []),
    // toFixed(1), not String(): strengths are rounded to one decimal, but String(1300.0)
    // is "1300", which sits a digit out of line beside "1450.5" and defeats the
    // tabular-nums this column is set in.
    el('span', { class: 'sum-pts', text: r.strength.toFixed(1) }, []),
  ]));

  container.appendChild(el('div', { class: 'summary' }, [
    el('h1', { text: 'Draft complete' }, []),
    // The schedule is not in the data, so this is an ordering of preseason projections
    // and nothing more. Saying so is the difference between information and a fake result.
    el('p', { class: 'meta', text: 'Teams ranked by the projected points of the best lineup they can start. This is a preseason projection, not a predicted finish.' }, []),
    // No sum-rank/sum-name/sum-grade/sum-pts classes here: those select a team's data
    // cell, and reusing them on the header would let '#'/'Team'/'Grade'/'Proj' answer
    // those queries too. The header still lines up under the grid via column order —
    // `.sum-head` and `.sum-row` share the same grid-template-columns.
    el('div', { class: 'sum-head' }, [
      el('span', { text: '#' }, []),
      el('span', { text: 'Team' }, []),
      el('span', { text: 'Grade' }, []),
      el('span', { text: 'Proj' }, []),
    ]),
    ...rowNodes,
    el('button', { text: 'Back to draft', style: { marginTop: '16px' }, onClick: handlers.onBack }, []),
  ]));
}
