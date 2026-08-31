import { assignSlots } from './roster.js';

// Reusing assignSlots rather than reimplementing "who starts" is the point: the grade and
// the roster panel are then incapable of disagreeing about a team's lineup.
export function teamStrength(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => !slot.label.startsWith('BN') && slot.player)
    .reduce((sum, slot) => sum + slot.player.projectedPoints, 0);
}

// Standard deviations from the league mean, each band inclusive at its floor.
export const GRADE_BANDS = [
  [1.5, 'A+'], [1.0, 'A'], [0.75, 'A-'], [0.5, 'B+'], [0.25, 'B'], [0, 'B-'],
  [-0.25, 'C+'], [-0.5, 'C'], [-0.75, 'C-'], [-1.0, 'D+'], [-1.5, 'D'],
];

// Used when every team is identical — before the first pick, most obviously. There is no
// information to rank anyone on, so everyone gets the same neutral letter rather than the
// implementation dividing by a zero standard deviation and grading the league NaN.
export const NEUTRAL_GRADE = 'C+';

export function gradeFor(z) {
  for (const [floor, grade] of GRADE_BANDS) if (z >= floor) return grade;
  return 'F';
}

export function gradeTeams(rostersByTeam, slots, teams) {
  const rows = teams.map((team, i) => ({
    teamIndex: i + 1,
    name: team.name,
    // One decimal: projections carry one, and a grade table full of raw floats reads as
    // false precision about a number that is a projection in the first place.
    strength: Math.round(teamStrength(rostersByTeam[i + 1] || [], slots) * 10) / 10,
  }));

  const count = rows.length || 1;
  const mean = rows.reduce((sum, r) => sum + r.strength, 0) / count;
  const sd = Math.sqrt(rows.reduce((sum, r) => sum + (r.strength - mean) ** 2, 0) / count);
  // A tolerance, not `sd === 0`. Equal strengths that are not exactly representable in
  // binary (203.7, say) leave `mean` off by ~1e-13, every deviation becomes the same
  // tiny non-zero number, and z = d/|d| collapses to exactly ±1 for the whole league —
  // an identical league graded D+ across the board. Below this, there is no information.
  const flat = Math.abs(sd) < 1e-9;

  return rows
    .map((r) => ({
      ...r,
      z: flat ? 0 : (r.strength - mean) / sd,
      grade: flat ? NEUTRAL_GRADE : gradeFor((r.strength - mean) / sd),
    }))
    .sort((a, b) => b.strength - a.strength || a.teamIndex - b.teamIndex)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
