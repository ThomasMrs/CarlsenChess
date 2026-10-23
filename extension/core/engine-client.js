// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { normalizeSettings, strengthProfile, parseInfo, validatePosition, isLegalUci, selectMove } from './analysis.js';

export class EngineClient {
  constructor(createWorker, random = Math.random) {
    this.worker = createWorker();
    this.waiters = [];
    this.current = null;
    this.dead = false;
    this.name = 'Stockfish 19';
    this.eloRange = { min: 1320, max: 3190 };
    this.random = random;
    this.worker.onmessage = (event) => {
      for (const line of String(event.data).split('\n')) this.handleLine(line.trim());
    };
    this.worker.onerror = () => this.dispose(new Error('Chargement Stockfish impossible. Rechargez l’extension.'));
    this.ready = this.boot();
    // Suppress an unhandled rejection if loading fails before a caller awaits ready.
    this.ready.catch(() => {});
  }

  send(command) { if (!this.dead) this.worker.postMessage(command); }

  waitFor(predicate, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error('Stockfish ne répond pas. Relancez l’analyse.'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  async boot() {
    const initialized = this.waitFor((line) => line === 'uciok');
    this.send('uci');
    await initialized;
    this.send('setoption name Hash value 64');
    const ready = this.waitFor((line) => line === 'readyok');
    this.send('isready');
    await ready;
  }

  handleLine(line) {
    if (line.startsWith('id name ')) this.name = line.slice(8);
    const range = line.match(/^option name UCI_Elo .* min (\d+) max (\d+)/);
    if (range) this.eloRange = { min: Number(range[1]), max: Number(range[2]) };
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(line)) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve(line);
      }
    }
    if (!this.current) return;
    const info = parseInfo(line);
    if (info) {
      const search = this.current;
      // Keep the existing latest-per-PV lines unchanged for move selection.
      search.lines.set(info.multipv, info);
      if (Number.isSafeInteger(info.depth) && info.depth > 0
        && Number.isSafeInteger(info.multipv) && info.multipv >= 1 && info.multipv <= search.profile.multiPv) {
        let depthLines = search.timingDepths.get(info.depth);
        if (!depthLines) { depthLines = new Map(); search.timingDepths.set(info.depth, depthLines); }
        depthLines.set(info.multipv, info);
        // A partial final iteration must not replace a comparable earlier pair.
        // Only a few recent depths and one complete snapshot remain in memory.
        while (search.timingDepths.size > 6) search.timingDepths.delete(search.timingDepths.keys().next().value);
        const first = depthLines.get(1);
        const second = depthLines.get(2);
        if (first && second && info.depth >= search.timingDepth
          && first.move !== second.move && search.timingLegalMoves.has(first.move) && search.timingLegalMoves.has(second.move)) {
          search.timingDepth = info.depth;
          search.timingLines = [...depthLines.values()].sort((a, b) => a.multipv - b.multipv)
            .filter((item) => search.timingLegalMoves.has(item.move));
        }
      }
    }
    if (line.startsWith('bestmove ')) {
      const search = this.current;
      this.current = null;
      clearTimeout(search.timer);
      if (search.cancelled || search.isCancelled()) return search.resolve({ cancelled: true });
      const [bestMove, , ponder] = line.slice(9).split(/\s+/);
      const lines = [...search.lines.values()].sort((a, b) => a.multipv - b.multipv)
        .filter((item) => isLegalUci(search.board, item.move));
      if (!isLegalUci(search.board, bestMove)) {
        search.reject(new Error('Le moteur a renvoyé un coup invalide pour cette position.'));
        return;
      }
      search.resolve({ bestMove, ponder, lines, timingLines: search.timingLines,
        selectedMove: selectMove(lines, bestMove, search.settings, this.random, search.board),
        engineName: this.name, eloLimited: search.settings.elo !== 'max',
        strengthMode: search.profile.strengthMode, targetElo: search.profile.targetElo });
    }
  }

  async analyze(fen, rawSettings = {}, isCancelled = () => false) {
    const board = validatePosition(fen);
    const settings = normalizeSettings(rawSettings);
    if (board.isGameOver()) return { bestMove: null, selectedMove: null, lines: [], timingLines: [], engineName: this.name, gameOver: true,
      strengthMode: strengthProfile(settings).strengthMode, targetElo: settings.elo };
    await this.ready;
    if (this.dead) throw new Error('Le moteur est arrêté. Relancez l’analyse.');
    if (isCancelled()) return { cancelled: true };
    if (this.current) throw new Error('Une analyse est déjà en cours.');
    const profile = strengthProfile(settings, this.eloRange);
    this.send(`setoption name UCI_LimitStrength value ${profile.strengthMode === 'native' ? 'true' : 'false'}`);
    if (profile.engineElo !== null) this.send(`setoption name UCI_Elo value ${profile.engineElo}`);
    // Restore full skill after a beginner search; UCI_Elo controls native targets.
    this.send(`setoption name Skill Level value ${profile.skillLevel}`);
    this.send(`setoption name MultiPV value ${profile.multiPv}`);
    // Barrier guarantees all options are applied before starting the next search.
    const synchronized = this.waitFor((line) => line === 'readyok', 10000);
    this.send('isready');
    await synchronized;
    if (isCancelled()) return { cancelled: true };
    return new Promise((resolve, reject) => {
      const timingLegalMoves = new Set(board.moves({ verbose: true })
        .map((move) => `${move.from}${move.to}${move.promotion || ''}`));
      this.current = { board, settings, profile, lines: new Map(), timingDepths: new Map(), timingDepth: -1, timingLines: [],
        timingLegalMoves, resolve, reject, isCancelled, cancelled: false,
        timer: setTimeout(() => this.dispose(new Error('Analyse interrompue après expiration du délai.')), profile.movetime + 15000) };
      this.send(`position fen ${board.fen()}`);
      this.send(`go movetime ${profile.movetime}${profile.searchDepth ? ` depth ${profile.searchDepth}` : ''}`);
    });
  }

  stop() {
    if (this.current) { this.current.cancelled = true; this.send('stop'); }
  }

  dispose(error = new Error('Moteur arrêté.')) {
    if (this.dead) return;
    this.dead = true;
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.waiters = [];
    if (this.current) { clearTimeout(this.current.timer); this.current.reject(error); this.current = null; }
    this.worker.terminate();
  }
}
