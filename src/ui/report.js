import { el } from './dom.js';

// Every line here states a computed fact. A section with nothing to say is omitted
// rather than padded, and nothing is phrased as judgement: "34 picks after an ADP of
// 62" is a measurement, "a steal of the draft" is the app claiming an authority it does
// not have. It would also be obviously templated by the third team.
// `note` is a once-per-section gloss, not a per-line one — see the blind spot below,
// where the alternative was repeating the same definition on every row.
function section(title, lines, note = null) {
  if (lines.length === 0) return null;
  return el('div', { class: 'rep-section' }, [
    el('h2', { text: title }, []),
    note ? el('p', { class: 'rep-note', text: note }, []) : null,
    ...lines,
  ]);
}

const line = (text) => el('div', { class: 'rep-line', text }, []);

// One helper for all four ADP lines. "1 picks before his ADP of 4" appeared six times
// in a single simulated draft, three of them in the headline reaches section, because
// the rule was known and applied only in blindSpotLine.
//
// The delta arrives from the core as a whole number of picks against the ADP as it is
// displayed, so nothing here rounds it: the sign is carried by the words "after" and
// "before", and the count is a magnitude.
const picks = (n) => (n === 1 ? '1 pick' : `${n} picks`);

// "an ADP", never "his ADP": the possessive adds nothing, and it was wrong outright on
// the D/ST lines this report used to be full of.
//
// `shownAdp`, not `Math.round(v.adp)`: the core measured the gap against the rounded
// ADP, so printing a second, independent rounding beside it is two derivations of the
// one guarantee this section rests on — that the ADP and the gap add back up to the
// pick number. There is now one derivation, in pickValues, and this prints it.
const fellTo = (v) => `${picks(v.delta)} after an ADP of ${v.shownAdp}`;
const wentAt = (v) => `${picks(-v.delta)} before an ADP of ${v.shownAdp}`;

function waiverLines(waivers) {
  return waivers.map((group) => el('div', { class: 'rep-line' }, [
    el('span', { class: 'rep-pos', text: group.position }, []),
    el('span', {
      text: group.players
        .map((pl) => `${pl.name} — ${pl.projectedPoints.toFixed(1)} (rank ${pl.overallRank})`)
        .join(', '),
    }, []),
  ]));
}

function stealLine(v) {
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${fellTo(v)}`);
}

// The delta is stored negative; the sign is carried by the word "before", so the
// number is rendered as a magnitude. "-45 picks before" reads as a double negative.
function reachLine(v) {
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${wentAt(v)}`);
}

function blindSpotLine(spot) {
  const plural = spot.count === 1 ? '' : 's';
  const best = spot.best ? ` The best still there is ${spot.best.name}, at ${spot.best.projectedPoints.toFixed(1)}.` : '';
  return line(`${spot.count} startable ${spot.position}${plural} went undrafted — anyone projecting above the replacement level of ${spot.bar.toFixed(1)}.${best}`);
}

function benchLine(b) {
  return line(`Round ${b.round} · ${b.teamName} — ${b.player.name} does not make their starting lineup.`);
}

function teamBlock(team) {
  const lines = [];
  if (team.spine.length > 0) {
    lines.push(el('div', { class: 'rep-spine' }, [
      el('span', { class: 'rep-label', text: 'Spine' }, []),
      el('span', { text: team.spine.map((s) => `${s.label} ${s.player.name}`).join(' · ') }, []),
    ]));
  }
  for (const clash of team.clashes) {
    lines.push(line(`${clash.players.length} starters are off in Week ${clash.week}: ${clash.players.map((p) => p.name).join(', ')}`));
  }
  if (team.bestValue) {
    lines.push(line(`Best value: ${team.bestValue.player.name}, ${fellTo(team.bestValue)}`));
  }
  if (team.biggestReach) {
    lines.push(line(`Earliest pick: ${team.biggestReach.player.name}, ${wentAt(team.biggestReach)}`));
  }
  return el('div', { class: 'rep-team' }, [
    el('h3', { text: team.name }, []),
    ...lines,
  ]);
}

// One sentence, once, at the top of the section rather than on each of its four
// possible rows. "the replacement level of 288.3" is jargon on a screen written for
// people who have never drafted; the VBD column elsewhere at least has a tooltip.
const REPLACEMENT_NOTE = 'Replacement level is what the best player at that position '
  + 'nobody has to start projects — the bar a drafted player has to clear.';

export function renderReport(container, report, onBack = null) {
  const sections = [
    section('Still on waivers', waiverLines(report.waivers)),
    section('Biggest steals', report.steals.map(stealLine)),
    section('Biggest reaches', report.reaches.map(reachLine)),
    // Not "The league's blind spot": the section holds one row per position and can
    // hold QB, RB, WR and TE at once, so a singular heading is wrong three times in
    // four. This one reads the same over one row and over four.
    section('Where the league was wrong', report.blindSpot.map(blindSpotLine), REPLACEMENT_NOTE),
    // Not "that never start". A bench WR3 starts on a bye week, so "never" states a
    // season-long certainty the data cannot support — and the line underneath already
    // says the accurate thing, that he does not make their starting lineup.
    section('Earliest picks that do not make a starting lineup', report.benched.map(benchLine)),
    section('Team by team', report.teams.map(teamBlock)),
  ].filter(Boolean);

  // A second Back to draft, at the bottom. The header one is five screens up by the
  // time the last team block ends, and appendFreshness puts the data stamp below the
  // whole report — so without this the last thing on the page is a date.
  if (onBack) {
    sections.push(el('button', { class: 'rep-back', text: 'Back to draft', onClick: onBack }, []));
  }

  container.appendChild(el('div', { class: 'report' }, sections));
}
