import { el, clear } from './dom.js';
import { DEFAULT_CONFIG } from '../core/state.js';

const SLOT_FIELDS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BENCH'];

// Resizes a form.teams array to exactly `numTeams` entries, preserving surviving
// rows (their name/keeperId/keeperRound) whether growing or shrinking, and
// appending fresh default rows when growing.
export function resizeTeams(teams, numTeams) {
  const result = teams.slice(0, numTeams);
  for (let i = result.length; i < numTeams; i += 1) {
    result.push({ name: `Team ${i + 1}`, keeperId: '', keeperRound: '' });
  }
  return result;
}

export function buildConfig(form) {
  const numTeams = Number(form.numTeams);
  const rounds = Number(form.rounds);

  const slots = {};
  for (const key of SLOT_FIELDS) slots[key] = Number(form.slots[key]) || 0;

  const teams = form.teams.slice(0, numTeams).map((team, i) => {
    const name = String(team.name || '').trim() || `Team ${i + 1}`;
    const hasPlayer = Boolean(team.keeperId);
    const hasRound = Boolean(String(team.keeperRound ?? '').trim());
    return {
      name,
      keeper: hasPlayer && hasRound
        ? { playerId: String(team.keeperId), round: Number(team.keeperRound) }
        : null,
      // Half a keeper is almost always a mistake — a name typed without picking a
      // suggestion, or a player chosen with the round left at "—". Silently dropping
      // it leaves the player in the pool and the board cell empty, so flag it instead.
      keeperPartial: hasPlayer !== hasRound,
    };
  });

  return {
    ...DEFAULT_CONFIG,
    numTeams,
    rounds,
    myTeamIndex: Number(form.myTeamIndex),
    slots,
    teams,
  };
}

export function validateConfig(config) {
  const errors = [];

  if (!(config.numTeams >= 4 && config.numTeams <= 16)) {
    errors.push('Number of teams must be between 4 and 16.');
  }
  if (!(config.rounds >= 1 && config.rounds <= 30)) {
    errors.push('Rounds must be between 1 and 30.');
  }
  if (!(config.myTeamIndex >= 1 && config.myTeamIndex <= config.numTeams)) {
    errors.push(`Draft position must be between 1 and ${config.numTeams}.`);
  }
  if (config.teams.length !== config.numTeams) {
    errors.push(`Team entries (${config.teams.length}) do not match the configured team count (${config.numTeams}).`);
  }

  const slotTotal = SLOT_FIELDS.reduce((sum, key) => sum + (config.slots[key] || 0), 0);
  if (slotTotal !== config.rounds) {
    errors.push(`Roster slots total ${slotTotal} but there are ${config.rounds} rounds — they must match.`);
  }

  const keeperIds = new Set();
  for (const team of config.teams) {
    if (team.keeperPartial) {
      errors.push(`${team.name}: keeper needs both a player and a round.`);
    }
    if (!team.keeper) continue;
    if (keeperIds.has(team.keeper.playerId)) {
      errors.push(`Two teams have the same keeper (${team.name}).`);
    }
    keeperIds.add(team.keeper.playerId);
    if (!(team.keeper.round >= 1 && team.keeper.round <= config.rounds)) {
      errors.push(`${team.name}: keeper round must be between 1 and ${config.rounds}.`);
    }
  }

  return errors;
}

function playerPicker(players, initialId, onChange) {
  const byId = new Map(players.map((p) => [p.id, p]));
  let selectedId = initialId || '';

  const input = el('input', {
    type: 'text',
    placeholder: 'search player…',
    value: selectedId && byId.has(selectedId) ? byId.get(selectedId).name : '',
  }, []);

  const list = el('div', { class: 'suggest-list', style: { display: 'none' } }, []);
  const wrap = el('div', { class: 'suggest' }, [input, list]);

  function close() {
    list.style.display = 'none';
    clear(list);
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    selectedId = '';
    onChange('');
    clear(list);
    if (query.length < 2) {
      close();
      return;
    }
    const matches = players.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8);
    for (const p of matches) {
      list.appendChild(el('div', {
        text: `${p.name} — ${p.position} ${p.team}`,
        onClick: () => {
          selectedId = p.id;
          input.value = p.name;
          onChange(p.id);
          close();
        },
      }, []));
    }
    list.style.display = matches.length ? 'block' : 'none';
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
  return wrap;
}

export function renderSetup(root, initialConfig, onStart, onImport) {
  const players = window.PLAYERS || [];
  const config = { ...DEFAULT_CONFIG, ...initialConfig };

  const form = {
    numTeams: config.numTeams,
    rounds: config.rounds,
    myTeamIndex: config.myTeamIndex,
    slots: { ...config.slots },
    teams: Array.from({ length: config.numTeams }, (_, i) => ({
      name: (config.teams[i] && config.teams[i].name) || `Team ${i + 1}`,
      keeperId: (config.teams[i] && config.teams[i].keeper && config.teams[i].keeper.playerId) || '',
      keeperRound: (config.teams[i] && config.teams[i].keeper && config.teams[i].keeper.round) || '',
    })),
  };

  clear(root);
  const errorBox = el('div', { class: 'notes', style: { display: 'none' } }, []);

  const numberField = (label, key, min, max, onCommit) => el('div', { class: 'field' }, [
    el('label', { text: label }, []),
    el('input', {
      type: 'number', min, max, value: form[key],
      onInput: (e) => { form[key] = e.target.value; },
      onChange: onCommit,
    }, []),
  ]);

  // Draft position buttons.
  const positionRow = el('div', { class: 'pos-grid' }, []);
  const drawPositions = () => {
    clear(positionRow);
    for (let i = 1; i <= Number(form.numTeams); i += 1) {
      positionRow.appendChild(el('button', {
        class: `pos-btn${Number(form.myTeamIndex) === i ? ' selected' : ''}`,
        text: String(i),
        onClick: () => { form.myTeamIndex = i; drawPositions(); },
      }, []));
    }
  };

  const slotFields = el('div', { class: 'field-row' }, SLOT_FIELDS.map((key) => el('div', { class: 'field' }, [
    el('label', { text: key }, []),
    el('input', {
      type: 'number', min: 0, max: 12, value: form.slots[key],
      style: { width: '64px' },
      onInput: (e) => { form.slots[key] = e.target.value; },
    }, []),
  ])));

  // Team & keeper table. Rebuilt in place whenever numTeams or rounds changes,
  // so the visible rows and dropdown options always match the current form.
  const tbody = el('tbody', {}, []);
  const drawTeamRows = () => {
    clear(tbody);
    form.teams.forEach((team, i) => {
      tbody.appendChild(el('tr', {}, [
        el('td', { text: String(i + 1) }, []),
        el('td', {}, [el('input', {
          type: 'text', value: team.name,
          onInput: (e) => { form.teams[i].name = e.target.value; },
        }, [])]),
        el('td', {}, [playerPicker(players, team.keeperId, (id) => { form.teams[i].keeperId = id; })]),
        el('td', {}, [el('select', {
          onChange: (e) => { form.teams[i].keeperRound = e.target.value; },
        }, [
          el('option', { value: '', text: '—' }, []),
          ...Array.from({ length: Number(form.rounds) }, (_, r) => el('option', {
            value: String(r + 1), text: String(r + 1),
            selected: String(team.keeperRound) === String(r + 1) ? 'selected' : null,
          }, [])),
        ])]),
      ]));
    });
  };

  // Re-derives form.teams/myTeamIndex when the Teams field is committed
  // (blur/Enter), preserving already-entered rows, then redraws the
  // position grid and team table to match the new count.
  const onNumTeamsChange = () => {
    const n = Number(form.numTeams);
    if (!Number.isFinite(n) || n <= 0) return;
    form.teams = resizeTeams(form.teams, n);
    if (Number(form.myTeamIndex) > n) form.myTeamIndex = n;
    drawPositions();
    drawTeamRows();
  };

  // Re-derives the keeper-round dropdown options when Rounds is committed;
  // clears any keeper round that no longer falls within the draft.
  const onRoundsChange = () => {
    const rounds = Number(form.rounds) || 0;
    form.teams.forEach((team) => {
      if (team.keeperRound && Number(team.keeperRound) > rounds) team.keeperRound = '';
    });
    drawTeamRows();
  };

  drawPositions();
  drawTeamRows();

  const importInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onChange: (e) => {
      const file = e.target.files && e.target.files[0];
      // Clear the control before handing the file off: a file input fires `change`
      // only when the selection changes, so declining the confirm and re-picking the
      // same file would otherwise do nothing and look broken.
      e.target.value = '';
      if (file && onImport) onImport(file);
    },
  }, []);
  const importRow = onImport
    ? el('div', { class: 'field', style: { marginTop: '12px' } }, [
      el('button', {
        text: 'Import backup', onClick: () => importInput.click(),
      }, []),
      el('div', { class: 'meta', text: 'Restore a draft saved with Save backup — on any machine.' }, []),
      importInput,
    ])
    : null;

  root.appendChild(el('div', { class: 'panel setup' }, [
    el('h1', { text: 'Draft Assistant — Setup' }, []),
    errorBox,

    el('h2', { text: 'League Settings' }, []),
    el('div', { class: 'field-row' }, [
      numberField('Teams', 'numTeams', 4, 16, onNumTeamsChange),
      numberField('Rounds', 'rounds', 1, 30, onRoundsChange),
      el('div', { class: 'field' }, [
        el('label', { text: 'Scoring' }, []),
        el('select', { disabled: 'disabled' }, [el('option', { text: 'Standard (non-PPR)' }, [])]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Draft type' }, []),
        el('select', { disabled: 'disabled' }, [el('option', { text: 'Snake' }, [])]),
      ]),
    ]),

    el('h2', { text: 'Your Draft Position' }, []),
    positionRow,

    el('h2', { text: 'Roster Slots' }, []),
    slotFields,

    el('h2', { text: 'Teams & Keepers' }, []),
    // Fixed-height scroller: changing the team count adds or removes rows inside
    // this box rather than growing the page, so nothing below it — the Start Draft
    // button in particular — shifts under the pointer mid-click.
    el('div', { class: 'teams-scroll' }, [
      el('table', { class: 'teams' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '#' }, []), el('th', { text: 'Team name' }, []),
          el('th', { text: 'Keeper (optional)' }, []), el('th', { text: 'Round' }, []),
        ])]),
        tbody,
      ]),
    ]),

    // Restoring a backup has to be reachable from HERE. Every catastrophe the backup
    // exists for — wiped storage, a different browser, a different laptop — puts the
    // user on the setup screen, and the draft screen's Import button does not exist
    // until a draft is already running.
    importRow,

    el('button', {
      class: 'primary',
      text: 'Start Draft',
      onClick: () => {
        const built = buildConfig(form);
        const errors = validateConfig(built);
        if (errors.length) {
          clear(errorBox);
          errorBox.style.display = 'block';
          for (const message of errors) errorBox.appendChild(el('div', { text: message }, []));
          return;
        }
        errorBox.style.display = 'none';
        onStart(built);
      },
    }, []),
  ]));
}
