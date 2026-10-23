// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { normalizeSettings, parseInfo, validatePosition, isLegalUci, selectMove } from './analysis.js';

export class EngineClient {
  constructor(createWorker) {
    this.worker = createWorker();
    this.waiters = [];
    this.current = null;
    this.dead = false;
    this.name = 'Stockfish 19';
    this.eloRange = { min: 1320, max: 3190 };
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
    if (info) this.current.lines.set(info.multipv, info);
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
      search.resolve({ bestMove, ponder, lines,
        selectedMove: selectMove(lines, bestMove, search.settings),
        engineName: this.name, eloLimited: search.settings.elo !== 'max' });
    }
  }

  async analyze(fen, rawSettings = {}, isCancelled = () => false) {
    const board = validatePosition(fen);
    if (board.isGameOver()) return { bestMove: null, selectedMove: null, lines: [], engineName: this.name, gameOver: true };
    const settings = normalizeSettings(rawSettings);
    await this.ready;
    if (this.dead) throw new Error('Le moteur est arrêté. Relancez l’analyse.');
    if (isCancelled()) return { cancelled: true };
    if (this.current) throw new Error('Une analyse est déjà en cours.');
    this.send(`setoption name UCI_LimitStrength value ${settings.elo === 'max' ? 'false' : 'true'}`);
    if (settings.elo !== 'max') this.send(`setoption name UCI_Elo value ${Math.max(this.eloRange.min, Math.min(this.eloRange.max, settings.elo))}`);
    this.send('setoption name MultiPV value 3');
    // Barrier guarantees all options are applied before starting the next search.
    const synchronized = this.waitFor((line) => line === 'readyok', 10000);
    this.send('isready');
    await synchronized;
    if (isCancelled()) return { cancelled: true };
    return new Promise((resolve, reject) => {
      this.current = { board, settings, lines: new Map(), resolve, reject, isCancelled, cancelled: false,
        timer: setTimeout(() => this.dispose(new Error('Analyse interrompue après expiration du délai.')), settings.movetime + 15000) };
      this.send(`position fen ${board.fen()}`);
      this.send(`go movetime ${settings.movetime}`);
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
