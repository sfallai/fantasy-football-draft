// ESPN's `experience` counts the current rookie class as 0 and the previous one as 2,
// so it cannot be trusted as a years-played number. Requiring no prior season is what
// makes this independent of whichever convention ESPN is using in a given year.
export function isRookie(player) {
  // Guarded like priorSummary below: both are called on whatever the caller has,
  // and a missing player is a "no" rather than a crash.
  return !!player
    && player.experience !== null
    && player.experience !== undefined
    && player.experience <= 1
    && !player.prior;
}

// A rookie has no prior season, and that absence is informative — so return null
// rather than a line of zeroes the reader would have to decode.
export function priorSummary(player) {
  const prior = player && player.prior;
  if (!prior) return null;
  return `${prior.points} pts in ${prior.games} games · ${prior.ppg} ppg`;
}
