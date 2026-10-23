// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
/** One explicitly enabled move, bound to a fresh position and a visible document. */
export function createAutoPlayer({ getState, play, authorize, onPending, onError,
  delay = 400, makeToken = () => crypto.randomUUID(),
}) {
  let generation = 0;
  let timer;
  let pending = null;
  let attempted = null;
  let destroyed = false;

  function cancel() {
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
    pending = null;
    authorize(null);
  }
  function allowed(ticket) {
    const current = getState();
    return !destroyed && current.enabled && current.visible && !current.manual
      && current.board?.isConnected && current.board === ticket.board
      && current.fen === ticket.fen && current.playerColor === ticket.playerColor
      && ticket.fen.split(/\s+/)[1] === current.playerColor;
  }
  return {
    schedule({ fen, uci, board }) {
      const state = getState();
      const ticket = { fen, uci, board, playerColor: state.playerColor,
        boardSelector: state.boardSelector || '', orientation: state.orientation };
      if (!allowed(ticket) || (attempted?.fen === fen && attempted.board === board)
        || (pending?.fen === fen && pending.board === board)) return false;
      cancel();
      const epoch = generation;
      pending = ticket;
      timer = setTimeout(async () => {
        timer = undefined;
        if (epoch !== generation || !allowed(ticket)) { cancel(); return; }
        const token = makeToken();
        ticket.executing = true;
        attempted = { fen, board };
        authorize(token);
        onPending?.();
        try {
          const response = await play({ ...ticket, token, requestId: token });
          if (epoch !== generation || destroyed) return;
          if (!response?.ok || !response.played) {
            onError?.(response?.error || 'Le site n’a pas accepté le coup automatique.');
          }
        } catch (error) {
          if (epoch === generation && !destroyed) onError?.(error?.message || 'Le coup automatique a échoué.');
        } finally {
          if (epoch === generation) { pending = null; authorize(null); }
        }
      }, delay);
      return true;
    },
    observe(fen, board) {
      // Promotion/animation can temporarily hide the FEN during our own move.
      // MAIN rechecks the immutable FEN/token before every remaining input.
      if (pending && (pending.board !== board || (!pending.executing && pending.fen !== fen))) cancel();
      if (fen && attempted && (attempted.board !== board || attempted.fen !== fen)) attempted = null;
    },
    reset() { cancel(); attempted = null; },
    isExecuting() { return pending?.executing === true; },
    cancel,
    destroy() { cancel(); destroyed = true; attempted = null; },
  };
}
