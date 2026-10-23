// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { Chess } from '../vendor/chess.js';
import { readPosition } from './board-adapter.js';
import { createPanel, syncSettings, setRunning, setStatus, clearSuggestion } from './panel.js';
import { createOverlay } from './overlay.js';

const DEFAULTS = Object.freeze({ strength: 'max', humanize: false, movetime: 1200, orientation: 'auto', boardSelector: '', fenSelector: '', manualFen: '', manualMode: false });
const SITE_KEYS = ['boardSelector', 'fenSelector', 'manualFen', 'manualMode'];
const GLOBAL_KEYS = ['strength', 'humanize', 'movetime', 'orientation'];

function normalizeSettings(raw = {}) {
  const strength = raw.strength === 'max' || raw.strength == null ? 'max' : Math.round(Math.min(3190, Math.max(1320, Number(raw.strength) || 2000)) / 10) * 10;
  return { ...DEFAULTS, strength, humanize: raw.humanize === true, movetime: [400, 1200, 2500].includes(Number(raw.movetime)) ? Number(raw.movetime) : 1200, orientation: ['white', 'black', 'auto'].includes(raw.orientation) ? raw.orientation : 'auto', boardSelector: String(raw.boardSelector || '').trim(), fenSelector: String(raw.fenSelector || '').trim(), manualFen: String(raw.manualFen || '').trim(), manualMode: raw.manualMode === true };
}

function validateFen(fen) {
  if (typeof fen !== 'string' || fen.trim().split(/\s+/).length !== 6) throw new Error('Il faut un FEN complet à 6 champs, avec le trait, les roques et les compteurs.');
  try { return new Chess(fen.trim()); } catch { throw new Error('Cette position FEN est invalide. Vérifiez les pièces, les rois et les 6 champs.'); }
}

export function legalSuggestion(fen, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('Le moteur n’a pas renvoyé de coup valide.');
  const chess = validateFen(fen);
  let move;
  try { move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }); } catch { /* Rejected below, without drawing an illegal move. */ }
  if (!move) throw new Error('Le coup reçu ne correspond plus à cette position. Actualisez l’analyse.');
  return move;
}

function evaluationText(score, turn) {
  if (!score || !Number.isFinite(Number(score.value))) return '—';
  const value = Number(score.value) * (turn === 'b' ? -1 : 1);
  if (score.type === 'mate') return value === 0 ? '#0' : `${value > 0 ? '+' : '−'}M${Math.abs(value)}`;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) / 100).toFixed(2)}`;
}

export function mount() {
  const existing = document.getElementById('carlsenchess-root');
  if (existing) return existing;
  const host = document.createElement('div');
  host.id = 'carlsenchess-root';
  host.style.cssText = "all:initial;position:fixed;inset:0;display:block;pointer-events:none;z-index:2147483600;isolation:isolate;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;color-scheme:dark;";
  const root = host.attachShadow({ mode: 'open' });
  const ui = createPanel(root);
  const overlay = createOverlay(root);
  document.documentElement.append(host);
  const state = { settings: { ...DEFAULTS }, stored: {}, running: false, visible: true, collapsed: false, loading: false, position: null, fingerprint: '', token: 0, timer: null, frame: null, manualFen: '', destroyed: false, board: null, storageQueue: Promise.resolve() };
  const resizeObserver = new ResizeObserver(() => scheduleReflow());

  function sendStop() {
    try { Promise.resolve(chrome.runtime.sendMessage({ type: 'CC_STOP' })).catch(() => {}); } catch { /* A reloaded extension can invalidate an older content script. */ }
  }
  function invalidate() {
    state.token += 1;
    state.loading = false;
    clearTimeout(state.timer);
    state.timer = null;
    overlay.clear();
    clearSuggestion(ui);
    sendStop();
  }
  function watchBoard(board) {
    if (board === state.board) return;
    resizeObserver.disconnect();
    state.board = board;
    if (board) resizeObserver.observe(board);
  }
  function orientation(position = state.position) {
    return state.settings.orientation === 'auto' ? position?.orientation || 'white' : state.settings.orientation;
  }
  function scheduleReflow() {
    if (state.frame != null) return;
    state.frame = requestAnimationFrame(() => { state.frame = null; overlay.reflow(); });
  }
  function snapshot() {
    const s = state.settings;
    let position;
    try { position = readPosition({ boardSelector: s.boardSelector, fenSelector: s.fenSelector, manualFen: s.manualMode ? state.manualFen || s.manualFen : '' }); }
    catch (error) { return { fen: '', board: null, source: '', error: error?.message || 'Impossible de lire le plateau.' }; }
    if (s.manualMode) {
      // Manual mode is explicit: site metadata must never replace the frozen FEN.
      return { ...position, fen: state.manualFen, source: 'manual', error: state.manualFen ? null : 'Saisissez un FEN complet dans « Connexion au plateau », puis démarrez.' };
    }
    return position || { fen: '', board: null, source: '', error: 'Aucune position détectée.' };
  }
  function positionKey(position) {
    return `${position.fen || ''}|${position.error || ''}|${orientation(position)}`;
  }
  function updateSource(position) {
    ui.refs.source.textContent = state.settings.manualMode ? 'FEN manuel' : position.fen ? `${position.fen.split(/\s+/)[1] === 'b' ? 'Trait aux Noirs' : 'Trait aux Blancs'}` : 'Détection auto';
    ui.refs.source.title = state.settings.manualMode ? 'La position saisie reste fixe jusqu’à la prochaine pause.' : position.source || 'Lecture de la position sur la page';
  }
  function reportPositionProblem(position) {
    if (!position.fen) {
      const message = position.error || (position.board ? 'Plateau trouvé, FEN complet manquant. Ouvrez « Connexion au plateau » pour le relier.' : 'Plateau introuvable. Renseignez son sélecteur CSS dans « Connexion au plateau ».');
      setStatus(ui, message, 'waiting');
      return true;
    }
    try { validateFen(position.fen); } catch (error) { setStatus(ui, error.message, 'error'); return true; }
    return false;
  }
  function observePosition(force = false, immediate = false) {
    if (!state.running || state.destroyed) return;
    const next = snapshot();
    watchBoard(next.board);
    const nextKey = positionKey(next);
    const changed = nextKey !== state.fingerprint || next.board !== state.position?.board;
    state.position = next;
    updateSource(next);
    if (!force && !changed) { scheduleReflow(); return; }
    state.fingerprint = nextKey;
    invalidate();
    if (reportPositionProblem(next)) return;
    setStatus(ui, 'Position reçue. Préparation du calcul…', 'loading');
    state.timer = setTimeout(() => { state.timer = null; analyze(next); }, immediate ? 0 : 180);
  }
  async function analyze(position) {
    if (!state.running || state.destroyed) return;
    let chess;
    try { chess = validateFen(position.fen); } catch (error) { setStatus(ui, error.message, 'error'); return; }
    if (chess.isGameOver()) {
      setStatus(ui, chess.isCheckmate() ? 'Échec et mat. Aucun coup à jouer.' : 'Cette position est terminée. Aucun coup à proposer.', 'complete');
      return;
    }
    const token = ++state.token;
    state.loading = true;
    setStatus(ui, 'Stockfish calcule votre prochain coup…', 'loading');
    try {
      const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${token}`;
      const response = await chrome.runtime.sendMessage({ type: 'CC_ANALYZE', requestId, fen: position.fen, settings: { elo: state.settings.strength, humanize: state.settings.humanize, movetime: state.settings.movetime } });
      if (token !== state.token || !state.running || state.destroyed) return;
      // The page may have moved while the worker was responding, before its observer ran.
      const current = snapshot();
      if (current.fen !== position.fen) { observePosition(true); return; }
      if (!response?.ok) throw new Error(response?.error || 'Le moteur ne répond pas. Réessayez avec « Actualiser ».');
      const result = response.result;
      const uci = result.selectedMove || result.bestMove;
      const move = legalSuggestion(position.fen, uci);
      const selectedLine = result.lines?.find(line => line.move === uci || line.pv?.[0] === uci);
      ui.refs.move.textContent = move.san;
      ui.refs.coordinates.textContent = `${move.from} → ${move.to}${move.promotion ? ` · promotion ${move.promotion.toUpperCase()}` : ''}`;
      ui.refs.evaluation.textContent = evaluationText(selectedLine?.score, chess.turn());
      ui.refs.evaluation.title = 'Évaluation pour les Blancs';
      const depth = selectedLine?.depth ? ` · profondeur ${selectedLine.depth}` : '';
      ui.refs.engine.textContent = `${result.engineName || 'Stockfish'}${depth}`;
      const board = current.board || position.board;
      watchBoard(board);
      state.position = { ...current, board };
      overlay.show(board, move, orientation(current));
      setStatus(ui, board ? `${chess.turn() === 'w' ? 'Blancs' : 'Noirs'} : suivez la flèche sur le plateau.${state.settings.humanize ? ' Choix varié activé.' : ''}` : 'Coup calculé. Reliez un plateau pour afficher la flèche.', 'ready');
    } catch (error) {
      if (token !== state.token || !state.running || state.destroyed) return;
      overlay.clear();
      clearSuggestion(ui);
      setStatus(ui, error?.message || 'L’analyse a échoué. Réessayez.', 'error');
    } finally {
      if (token === state.token) state.loading = false;
    }
  }
  function start() {
    state.running = true;
    state.manualFen = state.settings.manualMode ? ui.controls.manualFen.value.trim() : '';
    state.fingerprint = '';
    setRunning(ui, true);
    observePosition(true, true);
  }
  function pause(message = 'Analyse en pause. Démarrez pour reprendre.') {
    state.running = false;
    invalidate();
    setRunning(ui, false);
    setStatus(ui, message, 'idle');
  }
  function close() {
    pause();
    state.visible = false;
    state.collapsed = false;
    ui.panel.hidden = true;
    ui.reopen.hidden = true;
  }
  function open() {
    state.visible = true;
    state.collapsed = false;
    ui.panel.hidden = false;
    ui.reopen.hidden = true;
    ui.actions.start.focus({ preventScroll: true });
  }
  function toggle() {
    if (!state.visible || state.collapsed) open();
    else close();
  }
  function persist() {
    const settings = { ...state.settings };
    state.storageQueue = state.storageQueue.catch(() => {}).then(async () => {
      const stored = (await chrome.storage.local.get('ccSettings')).ccSettings || {};
      const globalSettings = Object.fromEntries(GLOBAL_KEYS.map(key => [key, settings[key]]));
      const siteSettings = Object.fromEntries(SITE_KEYS.map(key => [key, settings[key]]));
      await chrome.storage.local.set({ ccSettings: { ...stored, ...globalSettings, sites: { ...(stored.sites || {}), [location.origin]: siteSettings } } });
    }).catch(() => setStatus(ui, 'Réglages non enregistrés. Rechargez l’extension puis la page.', 'error'));
  }
  function settingsChanged(key) {
    const c = ui.controls;
    if (key === 'strengthMode') state.settings.strength = c.strengthMode.value === 'max' ? 'max' : Number(c.strength.value);
    else if (key === 'strength') state.settings.strength = Number(c.strength.value);
    else if (key === 'humanize' || key === 'manualMode') state.settings[key] = c[key].checked;
    else if (key === 'movetime') state.settings.movetime = Number(c.movetime.value);
    else state.settings[key] = c[key].value.trim();
    state.settings = normalizeSettings(state.settings);
    ui.refs.eloField.hidden = state.settings.strength === 'max';
    ui.refs.eloValue.value = c.strength.value;
    ui.refs.manualField.hidden = !state.settings.manualMode;
    persist();
    if (key === 'manualMode') {
      pause(state.settings.manualMode ? 'Mode manuel : collez un FEN complet, puis démarrez.' : 'Lecture automatique sélectionnée. Démarrez pour reprendre.');
      updateSource(state.position || {});
    } else if (key !== 'manualFen' && state.running) observePosition(true);
  }
  const observer = new MutationObserver(records => {
    if (records.every(record => record.target === host || host.contains(record.target))) return;
    observePosition();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  // Some games expose their FEN through JavaScript-backed attributes only after the render pass.
  const interval = setInterval(() => observePosition(), 1000);
  ui.actions.start.addEventListener('click', () => state.running ? pause() : start());
  ui.actions.refresh.addEventListener('click', () => observePosition(true, true));
  ui.actions.close.addEventListener('click', close);
  ui.actions.collapse.addEventListener('click', () => { state.collapsed = true; ui.panel.hidden = true; ui.reopen.hidden = false; ui.reopen.focus({ preventScroll: true }); });
  ui.reopen.addEventListener('click', open);
  Object.entries(ui.controls).forEach(([key, control]) => control.addEventListener('change', () => settingsChanged(key)));
  ui.controls.strength.addEventListener('input', () => { ui.refs.eloValue.value = ui.controls.strength.value; });
  const onEscape = event => {
    // Do not consume Escape from the game unless this panel currently owns focus.
    if (event.key === 'Escape' && root.activeElement) { event.preventDefault(); close(); }
  };
  window.addEventListener('carlsenchess:toggle', toggle);
  window.addEventListener('resize', scheduleReflow, { passive: true });
  window.addEventListener('scroll', scheduleReflow, { passive: true, capture: true });
  root.addEventListener('keydown', onEscape);

  host.carlsenChessDestroy = () => {
    if (state.destroyed) return;
    pause();
    state.destroyed = true;
    observer.disconnect();
    resizeObserver.disconnect();
    clearInterval(interval);
    if (state.frame != null) cancelAnimationFrame(state.frame);
    window.removeEventListener('carlsenchess:toggle', toggle);
    window.removeEventListener('resize', scheduleReflow);
    window.removeEventListener('scroll', scheduleReflow, true);
    host.remove();
  };
  chrome.storage.local.get('ccSettings').then(({ ccSettings = {} }) => {
    if (state.destroyed) return;
    const site = ccSettings.sites?.[location.origin] || {};
    state.settings = normalizeSettings({ ...ccSettings, ...site });
    syncSettings(ui, state.settings);
    updateSource({});
  }).catch(() => setStatus(ui, 'Impossible de charger les réglages. Les valeurs par défaut sont actives.', 'error'));
  return host;
}

mount();
