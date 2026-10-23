// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { readChessComPlacement } from './chesscom-bridge.js';

export function isChessComPage(location = globalThis.location) {
  return location?.protocol === 'https:' && (location.hostname === 'chess.com' || location.hostname.endsWith('.chess.com'));
}

/** A single, cancellable MAIN-world read at a time; cached data stays board-bound. */
export function createChessComReader({ getBoard, getSelector, onChange,
  send = (message) => chrome.runtime.sendMessage(message),
  getUrl = () => location.href, now = () => Date.now(), interval = 350, maxAge = 1500,
} = {}) {
  let active = false;
  let destroyed = false;
  let generation = 0;
  let timer;
  let inFlight = false;
  let cached = null;
  let lastError = 'Lecture de la position Chess.com…';

  function notify() { if (active && !destroyed) onChange?.(); }
  function schedule(delay = interval) {
    clearTimeout(timer);
    if (active && !destroyed) timer = setTimeout(tick, delay);
  }
  function selectorFor(board) {
    const explicit = getSelector?.()?.trim();
    if (explicit) return explicit;
    if (board?.id && globalThis.CSS?.escape) return `#${CSS.escape(board.id)}`;
    return '';
  }
  async function tick() {
    if (!active || destroyed || inFlight) return;
    const epoch = generation;
    const board = getBoard?.();
    const selector = getSelector?.() || '';
    const url = getUrl();
    if (!board?.isConnected) {
      cached = null;
      lastError = 'Plateau Chess.com introuvable. Ouvrez une partie ou une analyse.';
      notify();
      schedule();
      return;
    }
    inFlight = true;
    try {
      const result = await send({ type: 'CC_READ_CHESSCOM', boardSelector: selectorFor(board) });
      if (!active || destroyed || epoch !== generation || url !== getUrl()
        || selector !== (getSelector?.() || '') || board !== getBoard?.() || !board.isConnected) return;
      const fields = typeof result?.fen === 'string' ? result.fen.trim().split(/\s+/) : [];
      const placement = readChessComPlacement(board);
      if (!result?.ok || fields.length !== 6 || !placement || placement !== fields[0]
        || (result.boardId && result.boardId !== board.id)) {
        cached = null;
        lastError = result?.error || 'Position Chess.com en cours de mise à jour…';
      } else {
        cached = { board, url, selector, fen: result.fen.trim(), readAt: now() };
        lastError = '';
      }
      notify();
    } catch (error) {
      if (active && !destroyed && epoch === generation) {
        cached = null;
        lastError = error?.message || 'Lecture Chess.com indisponible. Rechargez l’extension et la page.';
        notify();
      }
    } finally {
      inFlight = false;
      schedule();
    }
  }
  return {
    setActive(value) {
      const next = value === true && !destroyed;
      if (next === active) return;
      active = next;
      generation += 1;
      cached = null;
      lastError = 'Lecture de la position Chess.com…';
      clearTimeout(timer);
      if (active && !inFlight) schedule(0);
    },
    read(base) {
      const board = base?.board;
      const current = cached && board?.isConnected && board === cached.board
        && cached.url === getUrl() && cached.selector === (getSelector?.() || '')
        && now() - cached.readAt <= maxAge && readChessComPlacement(board) === cached.fen.split(' ')[0];
      return current
        ? { ...base, fen: cached.fen, source: 'Chess.com · position du jeu', error: null }
        : { ...base, fen: null, source: 'Chess.com', error: lastError || 'Synchronisation du plateau Chess.com…' };
    },
    refresh() {
      // Selector, document or board changes cannot reuse an old response.
      generation += 1;
      cached = null;
      lastError = 'Lecture de la position Chess.com…';
      schedule(0);
    },
    destroy() {
      active = false;
      destroyed = true;
      generation += 1;
      cached = null;
      clearTimeout(timer);
    },
  };
}
