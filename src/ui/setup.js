import { el, clear } from './dom.js';
import { DEFAULT_CONFIG } from '../core/state.js';

const SLOT_FIELDS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BENCH'];

export function buildConfig(form) {
  const numTeams = Number(form.numTeams);
  const rounds = Number(form.rounds);

  const slots = {};
  for (const key of SLOT_FIELDS) slots[key] = Number(form.slots[key]) || 0;

  const teams = form.teams.slice(0, numTeams).map((team, i) => {
    const name = String(team.name || '').trim() || `Team ${i + 1}`;
    const hasKeeper = Boolean(team.keeperId) && Boolean(String(team.keeperRound).trim());
    return {
      name,
      keeper: hasKeeper
        ? { playerId: String(team.keeperId), round: Number(team.keeperRound) }
        : null,
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

  const slotTotal = SLOT_FIELDS.reduce((sum, key) => sum + (config.slots[key] || 0), 0);
  if (slotTotal !== config.rounds) {
    errors.push(`Roster slots total ${slotTotal} but there are ${config.rounds} rounds — they must match.`);
  }

  const keeperIds = new Set();
  for (const team of config.teams) {
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

export function renderSetup(root, initialConfig, onStart) {
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

  const numberField = (label, key, min, max) => el('div', { class: 'field' }, [
    el('label', { text: label }, []),
    el('input', {
      type: 'number', min, max, value: form[key],
      onInput: (e) => { form[key] = e.target.value; },
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
  drawPositions();

  const slotFields = el('div', { class: 'field-row' }, SLOT_FIELDS.map((key) => el('div', { class: 'field' }, [
    el('label', { text: key }, []),
    el('input', {
      type: 'number', min: 0, max: 12, value: form.slots[key],
      style: { width: '64px' },
      onInput: (e) => { form.slots[key] = e.target.value; },
    }, []),
  ])));

  const teamRows = form.teams.map((team, i) => el('tr', {}, [
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

  root.appendChild(el('div', { class: 'panel setup' }, [
    el('h1', { text: 'Draft Assistant — Setup' }, []),
    errorBox,

    el('h2', { text: 'League Settings' }, []),
    el('div', { class: 'field-row' }, [
      numberField('Teams', 'numTeams', 4, 16),
      numberField('Rounds', 'rounds', 1, 30),
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
    el('table', { class: 'teams' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '#' }, []), el('th', { text: 'Team name' }, []),
        el('th', { text: 'Keeper (optional)' }, []), el('th', { text: 'Round' }, []),
      ])]),
      el('tbody', {}, teamRows),
    ]),

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
