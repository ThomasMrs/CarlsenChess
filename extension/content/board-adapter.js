// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
const BOARD_SELECTORS = [
  '[data-carlsenchess-board]', 'cg-board', 'wc-chess-board', 'chess-board', '.chess-board', '#board', '.board',
];
const FEN_ATTRIBUTES = ['data-carlsenchess-fen', 'data-fen', 'data-chess-fen'];
const BOARD_QUERY = BOARD_SELECTORS.join(',');

function queryAll(root, selector) {
  try { return [...root.querySelectorAll(selector)]; } catch { return []; }
}

function visibleRectangle(element) {
  const rectangle = element.getBoundingClientRect();
  if (rectangle.width < 32 || rectangle.height < 32) return null;
  const ratio = rectangle.width / rectangle.height;
  if (ratio < 0.75 || ratio > 1.34) return null;
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (node.hidden || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return null;
  }
  return rectangle;
}

/** Find the largest visible, approximately square board. An explicit selector is exclusive. */
export function findBoard({ boardSelector = '' } = {}) {
  if (typeof document === 'undefined') return null;
  const onChessCom = document.location?.protocol === 'https:' &&
    (document.location.hostname === 'chess.com' || document.location.hostname.endsWith('.chess.com'));
  const selector = boardSelector.trim() || (onChessCom && queryAll(document, 'wc-chess-board').some(visibleRectangle) ? 'wc-chess-board' : BOARD_QUERY);
  const candidates = queryAll(document, selector)
    .map((board) => ({ board, rectangle: visibleRectangle(board) }))
    .filter(({ rectangle }) => rectangle);
  candidates.sort((a, b) => (b.rectangle.width * b.rectangle.height) - (a.rectangle.width * a.rectangle.height));
  return candidates[0]?.board ?? null;
}

function fullFen(value) {
  if (typeof value !== 'string') return null;
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 6) return null;
  const [placement, turn, castling, enPassant, halfmove, fullmove] = fields;
  const rows = placement.split('/');
  if (rows.length !== 8 || rows.some((row) => !/^[prnbqkPRNBQK1-8]+$/.test(row)
    || [...row].reduce((sum, character) => sum + (/^[1-8]$/.test(character) ? Number(character) : 1), 0) !== 8)) return null;
  if (!/^[wb]$/.test(turn) || !/^(?:-|K?Q?k?q?)$/.test(castling) || castling === '') return null;
  if (!/^(?:-|[a-h][36])$/.test(enPassant) || !/^\d+$/.test(halfmove) || !/^[1-9]\d*$/.test(fullmove)) return null;
  return fields.join(' ');
}

function attributedFen(element) {
  for (const attribute of FEN_ATTRIBUTES) {
    const fen = fullFen(element.getAttribute(attribute));
    if (fen) return { fen, source: attribute };
  }
  return null;
}

function boardCount(container, selectedBoard) {
  // Nested markers on the same physical board do not represent other positions.
  return queryAll(container, BOARD_QUERY).filter((candidate) => candidate !== selectedBoard
    && !selectedBoard.contains(candidate) && !candidate.contains(selectedBoard)).length;
}

function boardFen(board) {
  const ownFen = attributedFen(board);
  if (ownFen) return ownFen;
  // A wrapper may carry the complete position. Do not borrow metadata from a
  // page-wide element or a shared wrapper containing several independent boards.
  for (let container = board.parentElement; container && !['BODY', 'HTML'].includes(container.tagName); container = container.parentElement) {
    if (boardCount(container, board) > 0) break;
    const candidate = attributedFen(container);
    if (candidate) return candidate;
  }
  return null;
}

function selectedFen(selector, board) {
  if (!selector.trim()) return null;
  const document = board?.ownerDocument ?? globalThis.document;
  if (!document) return null;
  // The selector is an explicit user association and can target a FEN input
  // outside the board. Never scan every data-fen node elsewhere in the page.
  const elements = queryAll(document, selector);
  for (const element of elements) {
    const attributed = attributedFen(element);
    if (attributed) return { ...attributed, source: `selector: ${selector}` };
    const fen = fullFen('value' in element ? element.value : element.textContent);
    if (fen) return { fen, source: `selector: ${selector}` };
  }
  return null;
}

function boardOrientation(board) {
  for (let element = board; element; element = element.parentElement) {
    for (const attribute of ['data-carlsenchess-orientation', 'data-orientation', 'orientation']) {
      const value = element.getAttribute(attribute)?.trim().toLowerCase();
      if (value === 'white' || value === 'black') return value;
    }
    if (element.classList.contains('orientation-black') || element.classList.contains('flipped')) return 'black';
    if (element.classList.contains('orientation-white')) return 'white';
  }
  return 'white';
}

/** Read explicit complete FEN only; side to move, castling and en passant are never inferred. */
export function readPosition({ boardSelector = '', fenSelector = '', manualFen = '' } = {}) {
  const board = findBoard({ boardSelector });
  const orientation = board ? boardOrientation(board) : 'white';
  const position = (board ? boardFen(board) : null) || selectedFen(fenSelector, board);
  if (position) return { board, ...position, orientation, error: null };
  const fen = fullFen(manualFen);
  if (fen) return { board, fen, orientation, source: 'manual', error: null };
  return {
    board, fen: null, orientation, source: null,
    error: !board ? 'Aucun plateau visible détecté. Choisissez un sélecteur ou chargez la démo.'
      : 'FEN complète indisponible. Exposez data-carlsenchess-fen sur le plateau ou saisissez une FEN de six champs.',
  };
}

/** Convert an algebraic square into its centre in viewport coordinates. */
export function squareCenter(square, rectangle, orientation = 'white') {
  if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square) || !rectangle
    || !Number.isFinite(rectangle.left) || !Number.isFinite(rectangle.top)
    || !Number.isFinite(rectangle.width) || !Number.isFinite(rectangle.height)
    || rectangle.width <= 0 || rectangle.height <= 0 || !['white', 'black'].includes(orientation)) return null;
  let file = square.charCodeAt(0) - 97;
  let rank = 8 - Number(square[1]);
  if (orientation === 'black') { file = 7 - file; rank = 7 - rank; }
  return {
    x: rectangle.left + ((file + 0.5) * rectangle.width / 8),
    y: rectangle.top + ((rank + 0.5) * rectangle.height / 8),
  };
}
