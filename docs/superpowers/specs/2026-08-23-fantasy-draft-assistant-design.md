# Fantasy Football Draft Assistant — Design Spec

## Overview

A single-page browser app that assists during a live fantasy football snake draft. The user is filling in for someone at a physical draft where stickers are placed on a board. The app tracks all picks, manages the player pool, and recommends the best pick using a composite of BPA, positional need, and value-based drafting (VBD) signals.

**Target date:** August 29, 2026

## League Configuration (Defaults)

- **Teams:** 10
- **Scoring:** Standard (non-PPR)
- **Draft type:** Snake
- **Rounds:** 15
- **Draft position:** 4th or 7th (selected at setup)
- **Keepers:** 1 per team (optional)
- **Platform:** ESPN

### Roster Slots

| Slot | Count |
|------|-------|
| QB   | 1     |
| RB   | 2     |
| WR   | 2     |
| TE   | 1     |
| FLEX (RB/WR/TE) | 1 |
| K    | 1     |
| DEF  | 1     |
| Bench | 6    |
| **Total** | **15** |

No positional draft limits — any number of a given position can be drafted.

## Architecture

- **Single-page client-side web app** — no backend, no server, no install
- Opens directly from an HTML file in a browser (laptop)
- All logic runs in JavaScript: scoring, recommendations, draft state tracking
- Player data loaded from a bundled JSON file
- Draft state persists in `localStorage` (survives page refresh)
- No external dependencies at runtime

## Player Data

- Pre-loaded JSON file with player rankings for 2026 ESPN standard scoring
- Fields per player: name, team, position, overall rank, positional rank, projected points, ADP, bye week
- Data file is swappable — can be updated the morning of the draft
- Approximately 200-250 players (top options at QB, RB, WR, TE, K, DEF)

## Screens

### 1. Setup Screen

Pre-filled with league defaults. User confirms/adjusts before starting.

**Sections:**
- **League Settings:** Number of teams, scoring type, draft type, total rounds (all editable)
- **Draft Position:** Clickable 1-10 selector
- **Teams & Keepers:** Table with rows for each team:
  - Team number (auto)
  - Team name (editable, defaults to "Team 1" through "Team 10")
  - Keeper player (optional, autocomplete search from player pool)
  - Keeper round (optional, dropdown 1-15)
- **Roster Slots:** Editable grid showing position counts
- **Start Draft** button

**Keeper behavior:**
- Each team may have 0 or 1 keeper
- Keeper players are removed from the available pool when the draft starts
- Keeper picks are pre-filled on the draft board at the specified round with a "K" badge
- The draft skips that team's pick in the keeper round (already filled)

### 2. Draft Board (Main Screen) — Three-Panel Layout

#### Left Panel: My Team

- Shows all roster slots (QB, RB1, RB2, WR1, WR2, TE, FLEX, K, DEF, Bench x6)
- Filled slots show the drafted player name, color-coded by position
- Empty slots show "empty"
- Below the roster: **Positional Needs** list with priority tiers:
  - **High:** Starting slot with zero players at that position
  - **Medium:** Second starter needed (e.g., have 1 RB, need RB2)
  - **Low:** Bench depth / FLEX options
  - **None:** K and DEF (auto-deprioritized until late rounds)

#### Center Panel: Recommendations & Available Players

**Top section — Current Pick Info:**
- "Round X, Pick Y" indicator
- "Your pick" or "Team Z's pick" label
- When it's your pick: "Next pick: Round X, Pick Y (N picks away)"

**Recommendations (when it's your pick):**
- Top 3 recommended players displayed prominently
- Each recommendation shows:
  - Player name, position, NFL team
  - BPA rank
  - VBD score (value over replacement)
  - Which positional need it fills and at what priority
  - One-line "why" explanation (e.g., "Big positional drop-off — next RB is 2 rounds away")
  - Competitive awareness note when relevant (e.g., "2 of 3 teams picking before you need QB")

**Bottom section — All Available Players:**
- Scrollable list of all remaining players
- Sortable by: Overall rank, Position, VBD score, ADP
- Filterable by position (QB, RB, WR, TE, K, DEF)
- Search box for quick lookup

**Pick Entry (always visible at top of center panel):**
- Search box with autocomplete from remaining players
- Type a few letters, select from matches
- Confirms the pick and logs it to the current team
- Undo button to reverse the last pick
- Batch entry mode for catching up on missed picks

#### Right Panel: Draft Board Grid

- 10 columns (one per team) x 15 rows (one per round)
- Team names as column headers
- User's team column is highlighted/accented
- Each cell shows abbreviated player name
- Position color coding: QB (red), RB (blue), WR (green), TE (orange), K/DEF (gray)
- Current pick cell has a pulsing/highlighted indicator
- Snake order visualized (arrow direction alternates each round)
- Keeper picks show a "K" badge
- Hover on any cell: tooltip with full player details
- Click team column header: popover showing that team's full roster and positional needs

## Recommendation Engine

### Three Signals

**1. BPA (Best Player Available)**
- Raw ranking from pre-loaded data
- Simply: who is the best player still in the pool?

**2. Positional Need**
- Examines user's roster slots and what's filled
- Assigns priority tiers (High/Medium/Low/None) per position
- Boosts players at high-need positions in the composite score
- K and DEF are auto-deprioritized until rounds 13-14

**3. VBD (Value-Based Drafting)**
- For each available player, calculates the gap between their projected points and the "replacement level" player at the same position
- Replacement level = roughly the last starter-quality player at each position given league size (e.g., QB12 for 10-team 1-QB league, RB24 for 10-team 2-RB league)
- Higher VBD = bigger advantage over what you'd get by waiting

### Composite Score

The three signals are combined into a single ranking:
- BPA rank provides the baseline ordering
- Positional need applies a boost multiplier (High = significant boost, Medium = moderate, Low = slight, None = penalty)
- VBD adjusts within tiers — players with outsized VBD rise, players at deep positions with small VBD gaps fall

The exact weights can be tuned, but the logic prioritizes: don't reach for need over value, but when two players are close in value, prefer the one that fills a need.

### Competitive Awareness

- Tracks what positions each of the 10 teams has drafted
- Infers positional needs for other teams based on filled roster slots
- Between your current pick and your next pick, identifies what teams picking in between are likely to target
- Surfaces this as advisory notes: "3 teams between your picks need RB — only 2 top RBs left, grab one now"
- This is informational, not a hard override of the composite score

## Data Flow

1. **Setup** → User confirms settings, enters keepers → stored in localStorage
2. **Draft starts** → Player pool initialized from JSON, keepers removed and pre-assigned
3. **Each pick** → User searches player, confirms pick → player removed from pool, assigned to team, draft position advances (snake order), recommendations recalculate
4. **Undo** → Last pick reversed, player returned to pool, draft position steps back
5. **Page refresh** → Full state restored from localStorage

## Visual Design

- Dark theme (dark background, light text) — easier on eyes during a long draft
- Position color coding consistent throughout:
  - QB: Red
  - RB: Blue
  - WR: Green
  - TE: Orange
  - K/DEF: Gray
- Clean, readable fonts — information density over decoration
- Responsive within laptop screen sizes (not targeting mobile)

## Out of Scope

- Mobile/tablet optimization
- Multi-user / networked draft
- Live API data fetching (data is pre-loaded, swappable)
- Post-draft analysis or season management
- Trade or waiver wire functionality
- PPR or custom scoring variants (could be added later, but not for this draft)
