// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
/**
 * Attempt one board move through normal DOM input, then verify its result.
 * executeScript serializes this function alone: all helpers must remain inside.
 * Synthetic input is observable and Chess.com may reject it. No game mutation
 * API, network request, input-trust bypass, or automatic retry is used here.
 */
export async function playChessComMove(request) {
  let lastFen = null;
  let lock = null;
  let inputSent = false;
  const fail = (code, error) => ({ ok: false, played: false, fen: lastFen, error,
    code, inputSent, retryable: !inputSent });
  const success = (fen, expectedFen) => {
    // A confirmed move is no longer uncertain. A later legitimate game reset
    // can reuse this position on the same board with a fresh authorization.
    // Keep every unconfirmed attempt in the existing duplicate protection.
    lock?.attempts.delete(expectedFen);
    return { ok: true, played: true, fen, error: null,
      code: 'MOVE_CONFIRMED', inputSent, retryable: false };
  };
  try {
    const document = globalThis.document;
    const view = document?.defaultView;
    const hostname = document?.location?.hostname?.toLowerCase();
    if (document?.location?.protocol !== 'https:' || !hostname
      || (hostname !== 'chess.com' && !hostname.endsWith('.chess.com'))) {
      return fail('UNSUPPORTED_ORIGIN', 'Le jeu automatique est réservé aux pages HTTPS de chess.com.');
    }
    if (!request || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(request.uci || '')
      || request.uci.slice(0, 2) === request.uci.slice(2, 4)
      || !['w', 'b'].includes(request.color) || !['white', 'black'].includes(request.orientation)
      || typeof request.token !== 'string' || !request.token || request.token.length > 128) {
      return fail('INVALID_REQUEST', 'Demande de coup automatique invalide.');
    }
    const fullFen = (value) => {
      if (typeof value !== 'string') return null;
      const fields = value.trim().split(/\s+/);
      if (fields.length !== 6) return null;
      const [placement, turn, castling, ep, halfmove, fullmove] = fields;
      const ranks = placement.split('/');
      if (ranks.length !== 8 || ranks.some((rank) => !/^[prnbqkPRNBQK1-8]+$/.test(rank)
        || [...rank].reduce((n, c) => n + (/^[1-8]$/.test(c) ? Number(c) : 1), 0) !== 8)
        || !/^[wb]$/.test(turn) || !/^(?:-|K?Q?k?q?)$/.test(castling) || !castling
        || !/^(?:-|[a-h][36])$/.test(ep) || !/^\d+$/.test(halfmove)
        || !/^[1-9]\d*$/.test(fullmove) || !Number.isSafeInteger(Number(halfmove))
        || !Number.isSafeInteger(Number(fullmove))) return null;
      return fields.join(' ');
    };
    const expectedFen = fullFen(request.expectedFen);
    if (!expectedFen) return fail('INVALID_FEN', 'La position complète du coup automatique est invalide.');
    if (expectedFen.split(' ')[1] !== request.color) return fail('WRONG_TURN', 'Ce n’est pas le tour de la couleur choisie.');
    const authorized = () => document.getElementById('carlsenchess-root')
      ?.getAttribute('data-cc-play-token') === request.token;
    const inputAllowed = () => authorized();
    if (!authorized()) return fail('CANCELLED', 'Le jeu automatique a été arrêté ou la demande a expiré.');

    const visible = (element) => {
      for (let node = element; node?.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (node.id === 'carlsenchess-root' || node.hidden || style.display === 'none'
          || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
      }
      return element?.getRootNode?.()?.host?.id !== 'carlsenchess-root';
    };
    const orientationOf = (board) => {
      for (let node = board; node && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement) {
        const value = ['data-orientation', 'orientation', 'data-carlsenchess-orientation']
          .map((name) => node.getAttribute(name)?.trim().toLowerCase())
          .find((value) => ['white', 'black'].includes(value));
        if (value) return value;
        if (node.classList.contains('flipped') || node.classList.contains('orientation-black')) return 'black';
        if (node.classList.contains('orientation-white')) return 'white';
      }
      return 'white';
    };
    const readFen = (board) => {
      try { return typeof board.game?.getFEN === 'function' ? fullFen(board.game.getFEN()) : null; }
      catch { return null; }
    };
    const placementMap = (placement) => {
      const squares = new Map();
      placement.split('/').forEach((rank, row) => {
        let file = 1;
        for (const piece of rank) {
          if (/^[1-8]$/.test(piece)) file += Number(piece);
          else { squares.set(`${file}${8 - row}`, piece); file += 1; }
        }
      });
      return squares;
    };
    const placementString = (squares) => {
      const ranks = [];
      for (let rank = 8; rank >= 1; rank -= 1) {
        let row = ''; let empty = 0;
        for (let file = 1; file <= 8; file += 1) {
          const piece = squares.get(`${file}${rank}`);
          if (!piece) empty += 1;
          else { if (empty) row += empty; row += piece; empty = 0; }
        }
        ranks.push(row + (empty || ''));
      }
      return ranks.join('/');
    };
    const renderedPlacement = (board) => {
      // In a background tab, rAF can leave an otherwise completed animation in
      // "running" state. Exact DOM placement and source geometry still apply.
      if (document.visibilityState !== 'hidden' && typeof board.getAnimations === 'function'
        && board.getAnimations({ subtree: true }).some((animation) => {
        if (!animation.pending && ['finished', 'idle'].includes(animation.playState)) return false;
        const effect = animation.effect;
        const duration = effect?.getComputedTiming?.().activeDuration;
        return effect?.target?.matches?.('.piece') && Number.isFinite(duration) && duration > 0
          && (effect.getKeyframes?.() ?? []).some((frame) => Object.keys(frame).some((property) =>
            /^(?:transform|translate|top|right|bottom|left|inset|offsetPath|offsetDistance|insetInlineStart|insetInlineEnd|insetBlockStart|insetBlockEnd)$/.test(property)));
      })) return null;
      const squares = new Map();
      for (const element of board.querySelectorAll('.piece')) {
        if (!visible(element)) continue;
        const owner = element.closest('wc-chess-board, chess-board');
        if (owner && owner !== board && board.contains(owner)) continue;
        const codes = [...element.classList].filter((name) => /^[wb][prnbqk]$/.test(name));
        const locations = [...element.classList].filter((name) => /^square-[1-8][1-8]$/.test(name));
        if (codes.length !== 1 || locations.length !== 1 || squares.has(locations[0].slice(7))
          || element.classList.contains('dragging') || element.classList.contains('ghost')) return null;
        squares.set(locations[0].slice(7), codes[0][0] === 'w' ? codes[0][1].toUpperCase() : codes[0][1]);
      }
      return squares.size ? placementString(squares) : null;
    };
    let candidates;
    try {
      const selector = typeof request.boardSelector === 'string' ? request.boardSelector.trim() : '';
      candidates = [...document.querySelectorAll(selector || 'wc-chess-board, chess-board, #board-single .board, #board-analysis-board')];
    } catch { return fail('INVALID_SELECTOR', 'Sélecteur de plateau Chess.com invalide.'); }
    const boards = candidates.filter((board) => {
      if (!visible(board)) return false;
      const rect = board.getBoundingClientRect();
      return rect.width >= 32 && rect.height >= 32 && Math.abs(rect.width / rect.height - 1) < 0.03;
    }).sort((a, b) => {
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    const board = boards[0];
    if (!board) return fail('BOARD_UNAVAILABLE', 'Aucun plateau Chess.com visible.');
    lastFen = readFen(board);
    if (lastFen !== expectedFen) return fail('STALE_POSITION', 'La position a changé depuis l’analyse. Aucun coup n’a été envoyé.');
    if (orientationOf(board) !== request.orientation) return fail('ORIENTATION_CHANGED', 'Le plateau a changé d’orientation. Relancez l’analyse.');
    if (renderedPlacement(board) !== expectedFen.split(' ')[0]) {
      return fail('POSITION_TRANSITION', 'Le plateau est encore en mouvement. Réessayez après sa synchronisation.');
    }
    const rect = board.getBoundingClientRect();
    if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)
      || rect.left < 0 || rect.top < 0 || rect.right > view.innerWidth || rect.bottom > view.innerHeight) {
      return fail('BOARD_CLIPPED', 'Affichez le plateau entier à l’écran avant le jeu automatique.');
    }
    const hit = (x, y) => {
      if (typeof document.elementFromPoint !== 'function') return null;
      const target = document.elementFromPoint(x, y);
      return target && (target === board || board.contains(target)) && visible(target) ? target : null;
    };
    if ([[rect.left + 2, rect.top + 2], [rect.right - 2, rect.top + 2],
      [rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2]]
      .some(([x, y]) => !hit(x, y))) return fail('BOARD_OCCLUDED', 'Le plateau est masqué ou coupé. Rendez-le entièrement visible.');
    const numeric = (square) => `${square.charCodeAt(0) - 96}${square[1]}`;
    const from = numeric(request.uci.slice(0, 2));
    const to = numeric(request.uci.slice(2, 4));
    const squares = placementMap(expectedFen.split(' ')[0]);
    const movingPiece = squares.get(from);
    const isOwn = movingPiece && (movingPiece === movingPiece.toUpperCase() ? 'w' : 'b') === request.color;
    if (!isOwn) return fail('SOURCE_PIECE_MISMATCH', 'La case de départ ne contient pas une pièce de la couleur choisie.');
    const code = `${request.color}${movingPiece.toLowerCase()}`;
    const sourcePieces = [...board.querySelectorAll(`.piece.${code}.square-${from}`)].filter(visible);
    if (sourcePieces.length !== 1) return fail('SOURCE_PIECE_UNAVAILABLE', 'La pièce de départ n’est pas identifiable sur le plateau.');
    const isPromotion = movingPiece.toLowerCase() === 'p' && ['1', '8'].includes(to[1]);
    const promotion = request.uci[4];
    if (Boolean(promotion) !== isPromotion) return fail('INVALID_PROMOTION', 'Le choix de promotion du coup est invalide.');
    if ([...board.querySelectorAll('.promotion-window--visible')].some(visible)) {
      return fail('PROMOTION_OPEN', 'Terminez ou annulez la promotion déjà ouverte avant de relancer le jeu automatique.');
    }
    const squareCenter = (square) => {
      const file = Number(square[0]); const rank = Number(square[1]);
      return { x: rect.left + (request.orientation === 'white' ? file - 0.5 : 8.5 - file) * rect.width / 8,
        y: rect.top + (request.orientation === 'white' ? 8.5 - rank : rank - 0.5) * rect.height / 8 };
    };
    const sourceRect = sourcePieces[0].getBoundingClientRect();
    const source = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };
    const logicalSource = squareCenter(from);
    const destination = squareCenter(to);
    if (sourceRect.width <= 0 || sourceRect.height <= 0 || !Number.isFinite(source.x) || !Number.isFinite(source.y)
      || Math.abs(source.x - logicalSource.x) > rect.width / 24 || Math.abs(source.y - logicalSource.y) > rect.height / 24
      || !hit(source.x, source.y) || !hit(destination.x, destination.y)) {
      return fail('UNSTABLE_GEOMETRY', 'La géométrie des cases n’est pas stable ou une fenêtre masque le coup.');
    }
    const stateKey = Symbol.for('CarlsenChess.playChessComMove.locks');
    let state = globalThis[stateKey];
    if (!state || state.document !== document) {
      state = { document, boards: new WeakMap() };
      globalThis[stateKey] = state;
    }
    lock = state.boards.get(board);
    if (!lock) { lock = { busy: false, attempts: new Set() }; state.boards.set(board, lock); }
    if (lock.busy || lock.attempts.has(expectedFen)) {
      // A prior invocation has already emitted input for this same action/FEN.
      // Report that history so callers cannot automatically retry an uncertain move.
      inputSent = true;
      lock = null;
      return fail('DUPLICATE_ATTEMPT', 'Un coup automatique a déjà été tenté pour cette position.');
    }
    lock.busy = true;

    const clickAt = (point) => {
      if (!inputAllowed()) return false;
      const target = hit(point.x, point.y);
      if (!target) return false;
      const init = { bubbles: true, cancelable: true, composed: true, view,
        clientX: point.x, clientY: point.y, button: 0, buttons: 1, detail: 1 };
      const emit = (event) => {
        if (!inputAllowed()) return false;
        // Mark immediately before dispatch: even a throwing handler must never
        // make an already issued action look safe for automatic repetition.
        inputSent = true;
        lock.attempts.add(expectedFen);
        if (lock.attempts.size > 32) lock.attempts.delete(lock.attempts.values().next().value);
        target.dispatchEvent(event);
        return true;
      };
      if (typeof view.PointerEvent === 'function' && !emit(new view.PointerEvent('pointerdown', {
        ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }))) return false;
      if (!inputAllowed()) return false;
      if (!emit(new view.MouseEvent('mousedown', init))) return false;
      if (!inputAllowed()) return false;
      if (typeof view.PointerEvent === 'function' && !emit(new view.PointerEvent('pointerup', {
        ...init, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }))) return false;
      if (!inputAllowed()) return false;
      if (!emit(new view.MouseEvent('mouseup', { ...init, buttons: 0 }))) return false;
      if (!inputAllowed()) return false;
      return emit(new view.MouseEvent('click', { ...init, buttons: 0 }));
    };
    const stableBeforeInput = () => {
      const currentRect = board.getBoundingClientRect();
      return inputAllowed() && board.isConnected && visible(board)
        && readFen(board) === expectedFen && orientationOf(board) === request.orientation
        && ['left', 'top', 'width', 'height'].every((key) => Math.abs(currentRect[key] - rect[key]) < 0.5);
    };
    // No await between the final authorization check and the two square clicks.
    if (!stableBeforeInput()) return fail(authorized() ? 'BOARD_CHANGED' : 'CANCELLED', 'La demande a été annulée ou le plateau a changé.');
    if (!clickAt(source)) return fail(authorized() ? 'SOURCE_UNAVAILABLE' : 'CANCELLED', 'La case de départ est devenue inaccessible ou la demande a été annulée.');
    if (!stableBeforeInput()) return fail(authorized() ? 'BOARD_CHANGED' : 'CANCELLED', 'Le plateau a changé pendant la sélection de la pièce ou la demande a été annulée.');
    if (!clickAt(destination)) return fail(authorized() ? 'TARGET_UNAVAILABLE' : 'CANCELLED', 'La case d’arrivée est devenue inaccessible ou la demande a été annulée.');

    // Derive only the expected piece placement; legality is checked by Chess in
    // the background before injection. Handle castling and en passant explicitly.
    const captured = squares.get(to);
    squares.delete(from);
    squares.set(to, promotion ? (request.color === 'w' ? promotion.toUpperCase() : promotion) : movingPiece);
    if (movingPiece.toLowerCase() === 'p' && from[0] !== to[0] && !captured) squares.delete(`${to[0]}${from[1]}`);
    if (movingPiece.toLowerCase() === 'k' && Math.abs(Number(from[0]) - Number(to[0])) === 2) {
      const rookFrom = `${Number(to[0]) > Number(from[0]) ? '8' : '1'}${from[1]}`;
      const rookTo = `${Number(to[0]) > Number(from[0]) ? '6' : '4'}${from[1]}`;
      const rook = squares.get(rookFrom);
      squares.delete(rookFrom); if (rook) squares.set(rookTo, rook);
    }
    const expectedPlacement = placementString(squares);
    const nextTurn = request.color === 'w' ? 'b' : 'w';
    const deadline = Date.now() + 5000;
    let promotionChosen = false;
    const waitForChange = () => new Promise((resolve) => {
      let timer;
      let observer;
      const finish = () => { observer?.disconnect(); view.clearTimeout(timer); resolve(); };
      if (typeof view.MutationObserver === 'function') {
        observer = new view.MutationObserver(finish);
        observer.observe(board, { childList: true, subtree: true, attributes: true });
        const authorizationHost = document.getElementById('carlsenchess-root');
        if (authorizationHost) observer.observe(authorizationHost, {
          attributes: true, attributeFilter: ['data-cc-play-token'],
        });
      }
      timer = view.setTimeout(finish, 80);
    });
    // Bounded observation only: this loop never initiates another chess move.
    while (true) {
      lastFen = readFen(board);
      const fields = lastFen?.split(' ');
      if (!board.isConnected || orientationOf(board) !== request.orientation) {
        return fail('BOARD_CHANGED', 'Le plateau a changé après l’envoi du coup. Vérifiez la position avant de reprendre.');
      }
      const expectedApiResult = fields?.[0] === expectedPlacement && fields[1] === nextTurn;
      if (expectedApiResult) {
        // The authoritative game state confirms the exact requested result.
        // Rendering/rAF can remain pending in a background tab; it is not an
        // additional move confirmation and must not make a confirmed move fail.
        return success(lastFen, expectedFen);
      }
      if (!authorized()) return fail('CANCELLED', 'Le jeu automatique a été arrêté ou la demande a expiré.');
      if (promotion && !promotionChosen) {
        // These classes were observed on the real Chess.com analysis chooser.
        // Do not select another type if auto-queen or a changed UI prevents it.
        const choices = [...board.querySelectorAll(`.promotion-window.promotion-window--visible .promotion-piece.${request.color}${promotion}`)].filter(visible);
        if (choices.length > 1) return fail('PROMOTION_AMBIGUOUS', 'Choix de promotion ambigu. Terminez la promotion manuellement.');
        if (choices.length === 1) {
          if (!stableBeforeInput()) return fail(authorized() ? 'PROMOTION_INTERRUPTED' : 'CANCELLED', 'Promotion interrompue. Vérifiez le plateau et choisissez la pièce manuellement.');
          const choiceRect = choices[0].getBoundingClientRect();
          const point = { x: choiceRect.left + choiceRect.width / 2, y: choiceRect.top + choiceRect.height / 2 };
          const target = hit(point.x, point.y);
          if (choiceRect.width <= 0 || choiceRect.height <= 0 || !target
            || (target !== choices[0] && !choices[0].contains(target))
            || !clickAt(point)) return fail(authorized() ? 'PROMOTION_OCCLUDED' : 'CANCELLED', 'Le choix de promotion est masqué ou la demande a été annulée. Choisissez la pièce manuellement.');
          promotionChosen = true;
          // The choice may synchronously complete the move, including after a
          // delayed background wake-up. Re-read before considering expiration.
          continue;
        }
      }
      if (lastFen && lastFen !== expectedFen && !expectedApiResult) {
        return fail('RESULT_MISMATCH', 'Le résultat du coup ne correspond pas à la proposition. Vérifiez le plateau avant de reprendre.');
      }
      if (Date.now() >= deadline) break;
      // Always read again after waking, even when Chrome delayed the timer
      // beyond the nominal deadline. Never skip a late, valid confirmation.
      await waitForChange();
    }
    return fail(promotion && !promotionChosen ? 'PROMOTION_UNCONFIRMED' : 'MOVE_UNCONFIRMED', promotion && !promotionChosen
      ? 'La promotion n’a pas été confirmée. Terminez la promotion manuellement.'
      : 'Chess.com n’a pas confirmé le coup. Les clics synthétiques peuvent être refusés ; jouez manuellement.');
  } catch {
    return fail('UNEXPECTED_ERROR', 'Le coup automatique n’a pas pu être vérifié. Vérifiez le plateau avant de reprendre.');
  } finally {
    if (lock) lock.busy = false;
  }
}
