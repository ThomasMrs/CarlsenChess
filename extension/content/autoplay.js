// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
/** One explicitly enabled move, revalidated after every timer wake-up. */
export function createAutoPlayer({ getState, play, authorize, onPending, onError, onStale, onRetry,
  refresh = async () => {},
  delay = 400, makeToken = () => crypto.randomUUID(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let generation = 0;
  let timer;
  let pending = null;
  let attempted = null;
  let destroyed = false;

  function cancel() {
    generation += 1;
    clearTimer(timer);
    timer = undefined;
    pending = null;
    authorize(null);
  }
  function allowed(ticket) {
    const current = getState();
    return !destroyed && current.enabled && !current.manual
      && current.board?.isConnected && current.board === ticket.board
      && current.fen === ticket.fen && current.playerColor === ticket.playerColor
      && ticket.fen.split(/\s+/)[1] === current.playerColor;
  }
  function current(ticket, epoch) {
    return !destroyed && generation === epoch && pending === ticket;
  }
  function finish(ticket, epoch) {
    if (!current(ticket, epoch)) return;
    pending = null;
    ticket.preparing = false;
    ticket.executing = false;
    authorize(null);
  }
  function stale(ticket, epoch) {
    if (!current(ticket, epoch)) return;
    finish(ticket, epoch);
    onStale?.();
  }
  function arm(ticket, epoch, ms) {
    timer = setTimer(() => run(ticket, epoch), ms);
  }
  async function run(ticket, epoch) {
    if (!current(ticket, epoch)) return;
    timer = undefined;
    ticket.preparing = true;
    try {
      const result = await refresh();
      if (!current(ticket, epoch)) return;
      if (result === false || result?.ok === false || !allowed(ticket)) {
        stale(ticket, epoch);
        return;
      }
    } catch {
      stale(ticket, epoch);
      return;
    } finally {
      ticket.preparing = false;
    }
    if (!current(ticket, epoch)) return;
    const token = makeToken();
    authorize(token);
    onPending?.();
    if (!current(ticket, epoch)) return;
    ticket.executing = true;
    ticket.attemptCount += 1;
    attempted = { fen: ticket.fen, board: ticket.board, count: ticket.attemptCount, safeToRetry: false };
    let response;
    let thrown;
    try { response = await play({ ...ticket, token, requestId: token }); }
    catch (error) { thrown = error; }
    if (!current(ticket, epoch)) return;
    ticket.executing = false;
    authorize(null);
    if (!thrown && response?.ok && response.played) {
      finish(ticket, epoch);
      return;
    }
    const error = thrown?.message || response?.error || 'Le site n’a pas accepté le coup automatique.';
    if (!thrown && response?.ok === false && response.retryable === true
      && response.inputSent === false && ticket.attemptCount < 3) {
      attempted.safeToRetry = true;
      onRetry?.(error);
      if (current(ticket, epoch)) arm(ticket, epoch, 1000);
      return;
    }
    finish(ticket, epoch);
    onError?.(error, response, ticket);
  }
  return {
    schedule({ fen, uci, board, delayMs }) {
      const state = getState();
      const ticket = { fen, uci, board, playerColor: state.playerColor,
        boardSelector: state.boardSelector || '', orientation: state.orientation };
      const previous = attempted?.fen === fen && attempted.board === board ? attempted : null;
      if (!allowed(ticket) || (previous && !previous.safeToRetry)
        || (pending?.fen === fen && pending.board === board)) return false;
      cancel();
      const epoch = generation;
      ticket.attemptCount = previous?.count || 0;
      pending = ticket;
      const requestedDelay = Number.isFinite(delayMs) ? delayMs : Number.isFinite(delay) ? delay : 400;
      const waitMs = Math.round(Math.max(previous?.safeToRetry ? 1000 : 0, Math.min(10000, requestedDelay)));
      arm(ticket, epoch, waitMs);
      return true;
    },
    observe(fen, board) {
      // Promotion/animation can temporarily hide the FEN during our own move.
      // MAIN rechecks the immutable FEN/token before every remaining input.
      const knownFen = typeof fen === 'string' && fen.trim().split(/\s+/).length === 6;
      if (pending && (pending.board !== board || (!pending.executing && knownFen && pending.fen !== fen))) cancel();
      if (attempted && (attempted.board !== board || (knownFen && attempted.fen !== fen))) attempted = null;
    },
    reset() { cancel(); attempted = null; },
    isExecuting() { return pending?.executing === true; },
    isPreparing() { return pending?.preparing === true; },
    isPending() { return pending !== null; },
    cancel,
    destroy() { cancel(); destroyed = true; attempted = null; },
  };
}
