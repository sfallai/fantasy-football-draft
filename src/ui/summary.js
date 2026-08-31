import { el, clear } from './dom.js';
import { renderReport } from './report.js';

export function renderSummary(container, ctx, handlers) {
  clear(container);
  // End draft is unguarded and always has been, so this screen is reachable three picks
  // in. `complete` defaults to true for the callers that predate the flag — chunk F's
  // summary, and any test that renders the ranking on its own.
  const { rows, myTeamIndex, complete = true } = ctx;
  const { onBack, onPrint } = handlers;

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

  const summary = el('div', { class: 'summary' }, [
    // The button lives in the header, not after the rows: with the report below, a
    // button between the table and "Still on waivers" reads as the end of the page.
    el('div', { class: 'sum-title' }, [
      // The heading is the one thing on this screen that was not a measurement: with
      // three picks made it read "Draft complete" over a report saying 22 startable WRs
      // went undrafted, which made every true sentence under it read as nonsense.
      el('h1', { text: complete ? 'Draft complete' : 'Draft in progress' }, []),
      el('button', { text: 'Back to draft', onClick: onBack }, []),
      // Only when a caller supplies the handler. renderSummary is also called by tests
      // and by chunk F's original path, neither of which has a window to print.
      onPrint ? el('button', { class: 'btn-print', text: 'Print / Save as PDF', onClick: onPrint }, []) : null,
    ]),
    complete ? null : el('p', {
      class: 'meta',
      text: 'The draft is not over. Everything below covers the picks made so far.',
    }, []),
    // The schedule is not in the data, so this is an ordering of preseason projections
    // and nothing more. Saying so is the difference between information and a fake result.
    el('p', { class: 'meta', text: 'Teams ranked by the projected points of the best lineup they can start, not counting kickers or defenses. This is a preseason projection, not a predicted finish.' }, []),
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
  ]);

  // Optional: chunk F's summary renders without one, and so does any caller that has
  // not built a report.
  if (ctx.report) renderReport(summary, ctx.report, onBack);

  container.appendChild(summary);
}
