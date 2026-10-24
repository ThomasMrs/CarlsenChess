// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
/** Read the rendered Chess.com piece classes; null means incomplete or changing. */
export function readChessComPlacement(board) {
  try {
    if (!board) return null;
    const document = board.ownerDocument;
    if (document.visibilityState !== 'hidden' && typeof board.getAnimations === 'function' && board.getAnimations({ subtree: true }).some((animation) => {
      if (!animation.pending && ['finished', 'idle'].includes(animation.playState)) return false;
      const effect = animation.effect;
      if (!effect?.target?.matches?.('.piece')) return false;
      const duration = effect.getComputedTiming?.().activeDuration;
      if (!Number.isFinite(duration) || duration <= 0) return false;
      const motionProperties = /^(?:transform|translate|top|right|bottom|left|inset|offsetPath|offsetDistance|insetInlineStart|insetInlineEnd|insetBlockStart|insetBlockEnd)$/;
      return (effect.getKeyframes?.() ?? []).some((frame) => Object.keys(frame).some((property) => motionProperties.test(property)));
    })) return null;
    const pieces = [...board.querySelectorAll('.piece')].filter((piece) => {
      for (let node = piece; node && node.nodeType === 1; node = node.parentElement) {
        const style = document.defaultView?.getComputedStyle(node);
        if (node.id === 'carlsenchess-root' || node.hidden || style?.display === 'none'
          || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
      }
      const owner = piece.closest('wc-chess-board, chess-board');
      return !owner || owner === board || !board.contains(owner);
    });
    if (!pieces.length) return null;
    const squares = new Map();
    for (const piece of pieces) {
      const classes = [...piece.classList];
      const codes = classes.filter((name) => /^[wb][prnbqk]$/.test(name));
      const locations = classes.filter((name) => /^square-[1-8][1-8]$/.test(name));
      if (codes.length !== 1 || locations.length !== 1
        || classes.some((name) => /^(?:dragging|ghost)$/.test(name))) return null;
      const square = locations[0].slice(7);
      if (squares.has(square)) return null;
      const code = codes[0];
      squares.set(square, code[0] === 'w' ? code[1].toUpperCase() : code[1]);
    }
    const ranks = [];
    for (let rank = 8; rank >= 1; rank -= 1) {
      let row = '';
      let empty = 0;
      for (let file = 1; file <= 8; file += 1) {
        const piece = squares.get(`${file}${rank}`);
        if (!piece) empty += 1;
        else {
          if (empty) row += empty;
          row += piece;
          empty = 0;
        }
      }
      if (empty) row += empty;
      ranks.push(row);
    }
    return ranks.join('/');
  } catch { return null; }
}

/**
 * Read Chess.com's exposed game state in the page's MAIN JavaScript world.
 * Chrome serializes this function when injecting it: keep every helper inside it.
 * This function is read-only and never reconstructs missing FEN state.
 */
export function readChessComSnapshot(boardSelector = '') {
  const failure = (error, board = null, orientation = 'white') => ({
    ok: false, fen: null, orientation, boardId: board?.id || null, error,
  });

  try {
    const document = globalThis.document;
    const hostname = document?.location?.hostname?.toLowerCase();
    if (document?.location?.protocol !== 'https:' || !hostname
      || (hostname !== 'chess.com' && !hostname.endsWith('.chess.com'))) {
      return failure('La lecture Chess.com est réservée aux pages HTTPS de chess.com.');
    }

    const defaultSelector = 'wc-chess-board, chess-board, #board-single .board, #board-analysis-board';
    const explicitSelector = typeof boardSelector === 'string' ? boardSelector.trim() : '';
    let candidates;
    try { candidates = [...document.querySelectorAll(explicitSelector || defaultSelector)]; }
    catch { return failure('Sélecteur de plateau Chess.com invalide.'); }

    const isVisible = (element) => {
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        if (node.id === 'carlsenchess-root' || node.hidden) return false;
        const style = document.defaultView?.getComputedStyle(node);
        if (style?.display === 'none' || style?.visibility === 'hidden'
          || style?.visibility === 'collapse' || style?.opacity === '0') return false;
      }
      const root = element.getRootNode?.();
      if (root?.host?.id === 'carlsenchess-root') return false;
      return true;
    };

    const visibleBoards = candidates.map((board) => {
      if (!isVisible(board)) return null;
      const rect = board.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)
        || rect.width < 32 || rect.height < 32) return null;
      const ratio = rect.width / rect.height;
      if (ratio < 0.75 || ratio > 1.34) return null;
      return { board, area: rect.width * rect.height };
    }).filter(Boolean).sort((a, b) => b.area - a.area);
    const board = visibleBoards[0]?.board;
    if (!board) return failure('Aucun plateau Chess.com visible détecté. Ouvrez une partie ou une analyse.');

    let orientation = 'white';
    for (let node = board; node && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement) {
      const value = ['data-orientation', 'orientation', 'data-carlsenchess-orientation']
        .map((attribute) => node.getAttribute(attribute)?.trim().toLowerCase())
        .find((attribute) => attribute === 'white' || attribute === 'black');
      if (value) { orientation = value; break; }
      if (node.classList.contains('flipped') || node.classList.contains('orientation-black')) {
        orientation = 'black'; break;
      }
      if (node.classList.contains('orientation-white')) break;
    }

    const fullFen = (value) => {
      if (typeof value !== 'string') return null;
      const fields = value.trim().split(/\s+/);
      if (fields.length !== 6) return null;
      const [placement, turn, castling, enPassant, halfmove, fullmove] = fields;
      const ranks = placement.split('/');
      if (ranks.length !== 8 || ranks.some((rank) => !/^[prnbqkPRNBQK1-8]+$/.test(rank)
        || [...rank].reduce((sum, character) => sum + (/^[1-8]$/.test(character) ? Number(character) : 1), 0) !== 8)) return null;
      if (!/^[wb]$/.test(turn) || !/^(?:-|K?Q?k?q?)$/.test(castling) || castling === '') return null;
      if (!/^(?:-|[a-h][36])$/.test(enPassant) || !/^\d+$/.test(halfmove) || !/^[1-9]\d*$/.test(fullmove)) return null;
      if (!Number.isSafeInteger(Number(halfmove)) || !Number.isSafeInteger(Number(fullmove))) return null;
      return fields.join(' ');
    };

    let fen = null;
    let apiError = false;
    try {
      const game = board.game;
      if (game && typeof game.getFEN === 'function') fen = fullFen(game.getFEN());
    } catch { apiError = true; }
    if (!fen) {
      // Only explicitly published complete FEN attributes are valid fallbacks.
      for (const attribute of ['data-fen', 'fen', 'data-chess-fen', 'data-carlsenchess-fen']) {
        fen = fullFen(board.getAttribute(attribute));
        if (fen) break;
      }
    }
    if (!fen) return failure(apiError
      ? 'Le jeu Chess.com ne permet pas encore de lire sa FEN complète. Réessayez après le chargement.'
      : 'FEN complète Chess.com indisponible. Attendez le chargement du plateau ou ouvrez une analyse.', board, orientation);

    // Keep this helper identical to the exported one: executeScript serializes
    // readChessComSnapshot alone, so it cannot refer to module-level bindings.
    const readPlacement = (board) => {
      const document = board.ownerDocument;
      if (document.visibilityState !== 'hidden' && typeof board.getAnimations === 'function' && board.getAnimations({ subtree: true }).some((animation) => {
        if (!animation.pending && ['finished', 'idle'].includes(animation.playState)) return false;
        const effect = animation.effect;
        if (!effect?.target?.matches?.('.piece')) return false;
        const duration = effect.getComputedTiming?.().activeDuration;
        if (!Number.isFinite(duration) || duration <= 0) return false;
        const motionProperties = /^(?:transform|translate|top|right|bottom|left|inset|offsetPath|offsetDistance|insetInlineStart|insetInlineEnd|insetBlockStart|insetBlockEnd)$/;
        return (effect.getKeyframes?.() ?? []).some((frame) => Object.keys(frame).some((property) => motionProperties.test(property)));
      })) return null;
      const pieces = [...board.querySelectorAll('.piece')].filter((piece) => {
        for (let node = piece; node && node.nodeType === 1; node = node.parentElement) {
          const style = document.defaultView?.getComputedStyle(node);
          if (node.id === 'carlsenchess-root' || node.hidden || style?.display === 'none'
            || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
        }
        const owner = piece.closest('wc-chess-board, chess-board');
        return !owner || owner === board || !board.contains(owner);
      });
      if (!pieces.length) return null;
      const squares = new Map();
      for (const piece of pieces) {
        const classes = [...piece.classList];
        const codes = classes.filter((name) => /^[wb][prnbqk]$/.test(name));
        const locations = classes.filter((name) => /^square-[1-8][1-8]$/.test(name));
        if (codes.length !== 1 || locations.length !== 1
          || classes.some((name) => /^(?:dragging|ghost)$/.test(name))) return null;
        const square = locations[0].slice(7);
        if (squares.has(square)) return null;
        const code = codes[0];
        squares.set(square, code[0] === 'w' ? code[1].toUpperCase() : code[1]);
      }
      const ranks = [];
      for (let rank = 8; rank >= 1; rank -= 1) {
        let row = '';
        let empty = 0;
        for (let file = 1; file <= 8; file += 1) {
          const piece = squares.get(`${file}${rank}`);
          if (!piece) empty += 1;
          else {
            if (empty) row += empty;
            row += piece;
            empty = 0;
          }
        }
        if (empty) row += empty;
        ranks.push(row);
      }
      return ranks.join('/');
    };
    const placement = readPlacement(board);
    if (!placement || placement !== fen.split(' ')[0]) {
      return failure('Position Chess.com en cours de changement. Attendez la fin du mouvement.', board, orientation);
    }

    return { ok: true, fen, orientation, boardId: board.id || null, placement, error: null };
  } catch {
    return failure('Lecture Chess.com temporairement indisponible. Réessayez après le chargement du plateau.');
  }
}
