export const POSITION_COLORS = {
  QB: '#ef4444',
  RB: '#3b82f6',
  WR: '#22c55e',
  TE: '#f97316',
  K: '#9ca3af',
  DEF: '#9ca3af',
};

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  const options = attrs || {};

  for (const [key, value] of Object.entries(options)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }

  for (const child of children || []) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function abbreviate(name) {
  const cleaned = String(name).replace(/\s+D\/ST$/, '');
  const parts = cleaned.split(' ');
  if (parts.length < 2) return cleaned;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export function formatPick(overallPick, numTeams) {
  const round = Math.floor((overallPick - 1) / numTeams) + 1;
  const inRound = ((overallPick - 1) % numTeams) + 1;
  return `${round}.${String(inRound).padStart(2, '0')}`;
}
