// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { Chess } from '../vendor/chess.js';

export function normalizeSettings(raw = {}) {
  const requested = Number(raw.elo);
  return {
    elo: raw.elo == null || raw.elo === '' || raw.elo === 'max' || !Number.isFinite(requested)
      ? 'max' : Math.max(500, Math.min(3000, Math.round(requested / 500) * 500)),
    humanize: raw.humanize === true,
    movetime: Math.max(200, Math.min(10000, Math.round(Number(raw.movetime) || 1200))),
  };
}

// These beginner profiles are deliberately approximate, not measured human ratings.
const beginnerProfiles = {
  500: { skillLevel: 0, searchDepth: 3, maxMovetime: 200, mistakeChance: 0.35, tolerance: 300 },
  1000: { skillLevel: 4, searchDepth: 6, maxMovetime: 350, mistakeChance: 0.10, tolerance: 140 },
};

export function strengthProfile(rawSettings = {}, eloRange = { min: 1320, max: 3190 }) {
  const settings = normalizeSettings(rawSettings);
  const beginner = beginnerProfiles[settings.elo];
  return {
    targetElo: settings.elo,
    strengthMode: beginner ? 'approximate' : settings.elo === 'max' ? 'max' : 'native',
    engineElo: settings.elo === 'max' || beginner ? null
      : Math.max(eloRange.min, Math.min(eloRange.max, settings.elo)),
    skillLevel: beginner?.skillLevel ?? 20,
    searchDepth: beginner?.searchDepth ?? null,
    movetime: beginner ? Math.min(settings.movetime, beginner.maxMovetime) : settings.movetime,
    multiPv: beginner ? 5 : 3,
  };
}

export function parseInfo(line) {
  if (!line.startsWith('info ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const pv = line.match(/\bpv\s+(.+)$/)?.[1]?.trim().split(/\s+/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!pv || !score || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(pv[0])) return null;
  return { move: pv[0], pv, score: { type: score[1], value: Number(score[2]) },
    depth: Number(line.match(/\bdepth (\d+)/)?.[1] || 0),
    multipv: Number(line.match(/\bmultipv (\d+)/)?.[1] || 1) };
}

export function validatePosition(fen) {
  if (typeof fen !== 'string' || fen.length > 200 || fen.trim().split(/\s+/).length !== 6) {
    throw new Error('Une FEN complète à six champs est nécessaire.');
  }
  const board = new Chess(fen.trim());
  const otherKing = board.board().flat().find((piece) => piece?.type === 'k' && piece.color !== board.turn());
  if (otherKing && board.isAttacked(otherKing.square, board.turn())) {
    throw new Error('Position illégale : le roi du camp qui vient de jouer est en échec.');
  }
  return board;
}

export function isLegalUci(board, move) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move || '')) return false;
  return board.moves({ verbose: true }).some((legal) =>
    legal.from === move.slice(0, 2) && legal.to === move.slice(2, 4) && (legal.promotion || '') === move.slice(4));
}

export function selectMove(lines, bestMove, settings, random = Math.random, board = null) {
  const beginner = beginnerProfiles[settings.elo];
  // The legal fallback makes low strength effective even if MultiPV has only one line,
  // or Stockfish's skill setting chooses a move outside those lines.
  if (beginner && board) {
    const alternatives = board.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion || ''}`)
      .filter((move) => move !== bestMove);
    if (alternatives.length && random() < beginner.mistakeChance) {
      return alternatives[Math.min(alternatives.length - 1, Math.floor(random() * alternatives.length))];
    }
  }
  if ((!settings.humanize && !beginner) || lines.length < 2) return bestMove;
  const best = lines.find((line) => line.move === bestMove);
  // Limited-strength UCI may intentionally choose a move outside MultiPV.
  if (!best) return bestMove;
  // Preserve forced mates; only introduce variation in centipawn-scored positions.
  if (best.score.type !== 'cp') return bestMove;
  const tolerance = beginner?.tolerance ?? (settings.elo === 'max' ? 25 : Math.round(25 + (3190 - settings.elo) / 25));
  const candidates = lines.filter((line) => line.score.type === 'cp' &&
    best.score.value - line.score.value >= 0 && best.score.value - line.score.value <= tolerance &&
    (!board || isLegalUci(board, line.move)));
  if (candidates.length < 2) return bestMove;
  // Beginner strength remains active without humanization. Enabling it gives
  // already-admissible alternatives more weight, without widening the pool.
  const temperature = Math.max(12, tolerance / 2) * (beginner && settings.humanize ? 1.5 : 1);
  const weighted = candidates.map((line) => ({ line, weight: Math.exp((line.score.value - best.score.value) / temperature) }));
  let draw = random() * weighted.reduce((sum, item) => sum + item.weight, 0);
  for (const item of weighted) { draw -= item.weight; if (draw <= 0) return item.line.move; }
  return weighted.at(-1).line.move;
}
