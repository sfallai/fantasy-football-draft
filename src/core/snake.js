// Snake draft order. Rounds, team indices, and overall picks are all 1-based.

export function pickToSlot(overallPick, numTeams) {
  const zero = overallPick - 1;
  const round = Math.floor(zero / numTeams) + 1;
  const indexInRound = zero % numTeams;
  // Odd rounds run 1..N, even rounds run N..1.
  const teamIndex = round % 2 === 1 ? indexInRound + 1 : numTeams - indexInRound;
  return { round, teamIndex };
}

export function slotToPick(round, teamIndex, numTeams) {
  const indexInRound = round % 2 === 1 ? teamIndex - 1 : numTeams - teamIndex;
  return (round - 1) * numTeams + indexInRound + 1;
}

export function totalPicks(numTeams, rounds) {
  return numTeams * rounds;
}

export function teamPicks(teamIndex, numTeams, rounds) {
  const picks = [];
  for (let round = 1; round <= rounds; round += 1) {
    picks.push(slotToPick(round, teamIndex, numTeams));
  }
  return picks.sort((a, b) => a - b);
}

export function nextPickForTeam(afterPick, teamIndex, numTeams, rounds) {
  const picks = teamPicks(teamIndex, numTeams, rounds);
  for (const pick of picks) {
    if (pick > afterPick) return pick;
  }
  return null;
}
