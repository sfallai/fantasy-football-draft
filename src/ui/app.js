import { clear } from './dom.js';
import { renderSetup } from './setup.js';
import { DEFAULT_CONFIG, createState, saveState } from '../core/state.js';

export function init() {
  const root = document.getElementById('app');
  clear(root);
  renderSetup(root, DEFAULT_CONFIG, (config) => {
    const state = createState(config);
    saveState(state);
    root.textContent = `Draft started: ${Object.keys(state.picks).length} keeper(s) placed.`;
  });
}

init();
