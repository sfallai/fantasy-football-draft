import { el } from './dom.js';

// Every line here states a computed fact. A section with nothing to say is omitted
// rather than padded, and nothing is phrased as judgement: "34 picks after his ADP of
// 62" is a measurement, "a steal of the draft" is the app claiming an authority it does
// not have. It would also be obviously templated by the third team.
function section(title, lines) {
  if (lines.length === 0) return null;
  return el('div', { class: 'rep-section' }, [
    el('h2', { text: title }, []),
    ...lines,
  ]);
}

const line = (text) => el('div', { class: 'rep-line', text }, []);

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
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${Math.round(v.delta)} picks after his ADP of ${Math.round(v.adp)}`);
}

// The delta is stored negative; the sign is carried by the word "before", so the
// number is rendered as a magnitude. "-45 picks before" reads as a double negative.
function reachLine(v) {
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${Math.round(-v.delta)} picks before his ADP of ${Math.round(v.adp)}`);
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
    lines.push(line(`Best value: ${team.bestValue.player.name}, ${Math.round(team.bestValue.delta)} picks after his ADP of ${Math.round(team.bestValue.adp)}`));
  }
  if (team.biggestReach) {
    lines.push(line(`Earliest pick: ${team.biggestReach.player.name}, ${Math.round(-team.biggestReach.delta)} picks before his ADP of ${Math.round(team.biggestReach.adp)}`));
  }
  return el('div', { class: 'rep-team' }, [
    el('h3', { text: team.name }, []),
    ...lines,
  ]);
}

export function renderReport(container, report) {
  const sections = [
    section('Still on waivers', waiverLines(report.waivers)),
    section('Biggest steals', report.steals.map(stealLine)),
    section('Biggest reaches', report.reaches.map(reachLine)),
    section('The league\'s blind spot', report.blindSpot.map(blindSpotLine)),
    section('Earliest picks that never start', report.benched.map(benchLine)),
    section('Team by team', report.teams.map(teamBlock)),
  ].filter(Boolean);

  container.appendChild(el('div', { class: 'report' }, sections));
}
