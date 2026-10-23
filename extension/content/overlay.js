// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { squareCenter } from './board-adapter.js';
const NS = 'http://www.w3.org/2000/svg';
const node = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
};

export function createOverlay(root) {
  const svg = node('svg', { class: 'cc-overlay', 'aria-hidden': 'true' });
  const defs = node('defs');
  const marker = node('marker', { id: 'cc-arrow-head', viewBox: '0 0 12 12', refX: '9', refY: '6', markerWidth: '3.2', markerHeight: '3.2', orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
  marker.append(node('path', { d: 'M 0 0 L 12 6 L 0 12 Z', fill: '#e2a66f' }));
  defs.append(marker);
  const source = node('rect', { class: 'cc-square cc-square-source' });
  const target = node('rect', { class: 'cc-square cc-square-target' });
  const arrow = node('line', { class: 'cc-arrow', 'marker-end': 'url(#cc-arrow-head)' });
  svg.append(defs, source, target, arrow);
  root.append(svg);
  let active = null;
  function clear() {
    active = null;
    svg.hidden = true;
    svg.style.display = 'none';
  }
  function reflow() {
    if (!active?.board?.isConnected) return clear();
    const rect = active.board.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return clear();
    const from = squareCenter(active.from, rect, active.orientation);
    const to = squareCenter(active.to, rect, active.orientation);
    if (!from || !to) return clear();
    const cellWidth = rect.width / 8;
    const cellHeight = rect.height / 8;
    const inset = Math.min(cellWidth, cellHeight) * .06;
    [[source, from], [target, to]].forEach(([el, center]) => {
      el.setAttribute('x', center.x - cellWidth / 2 + inset);
      el.setAttribute('y', center.y - cellHeight / 2 + inset);
      el.setAttribute('width', cellWidth - inset * 2);
      el.setAttribute('height', cellHeight - inset * 2);
      el.setAttribute('rx', Math.min(cellWidth, cellHeight) * .06);
    });
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const pullback = Math.min(cellWidth, cellHeight) * .23;
    const endX = to.x - (to.x - from.x) / distance * pullback;
    const endY = to.y - (to.y - from.y) / distance * pullback;
    Object.entries({ x1: from.x, y1: from.y, x2: endX, y2: endY, 'stroke-width': Math.max(5, Math.min(cellWidth, cellHeight) * .12) }).forEach(([key, value]) => arrow.setAttribute(key, value));
    svg.setAttribute('width', String(window.innerWidth));
    svg.setAttribute('height', String(window.innerHeight));
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.hidden = false;
    svg.style.display = 'block';
  }
  function show(board, move, orientation) {
    if (!board || !move) return clear();
    active = { board, from: move.from, to: move.to, orientation };
    reflow();
  }
  clear();
  return { show, clear, reflow };
}
