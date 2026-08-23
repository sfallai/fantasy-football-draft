import { el, clear } from './dom.js';

export function init() {
  const root = document.getElementById('app');
  clear(root);
  root.appendChild(el('div', { class: 'setup', text: `Loaded ${window.PLAYERS.length} players.` }, []));
}

init();
