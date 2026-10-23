// Copyright (c) 2026 Thomas Marsa. GPL-3.0-only.
import { Chess } from '../vendor/chess.js';

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const neutral = (reason = 'Analyses comparables insuffisantes') => ({ targetMs: 3200, level: 'Neutre', reason });
const uciOf = (move) => `${move.from}${move.to}${move.promotion || ''}`;

function bestGap(lines, legalMoves, fen) {
  if (!Array.isArray(lines)) return null;
  const latest = new Map();
  for (const line of lines) {
    if (!line || ![1, 2].includes(line.multipv) || !Number.isInteger(line.depth) || line.depth < 1
      || !legalMoves.has(line.move) || !['cp', 'mate'].includes(line.score?.type)
      || !Number.isFinite(line.score.value) || !Number.isInteger(line.score.value)) continue;
    if (line.pv !== undefined && (!Array.isArray(line.pv) || !line.pv.length
      || line.pv[0] !== line.move || line.pv.some((move) => typeof move !== 'string' || !UCI.test(move)))) continue;
    if (line.pv?.length > 1) {
      const variation = new Chess(fen);
      try {
        for (const move of line.pv) variation.move({ from: move.slice(0, 2), to: move.slice(2, 4),
          ...(move[4] ? { promotion: move[4] } : {}) });
      } catch { continue; }
    }
    const previous = latest.get(line.multipv);
    // Ignore duplicate ranks at the same depth; a deeper record supersedes them.
    if (!previous || line.depth > previous.depth) latest.set(line.multipv, line);
  }
  const first = latest.get(1);
  const second = latest.get(2);
  // Never infer the best-move gap from PV2/PV3 or a partial MultiPV update.
  if (!first || !second || first.depth !== second.depth || first.move === second.move
    || first.score.type !== 'cp' || second.score.type !== 'cp'
    || first.score.value < second.score.value) return null;
  return first.score.value - second.score.value;
}

/**
 * Deterministic pacing heuristic, not a measured human reaction-time model.
 * `lines` needs legal, distinct PV1/PV2 records with equal positive `depth`
 * and integer centipawn scores. Invalid input returns a neutral 3200 ms.
 * `pv` is optional; if supplied, it must match the root move and be legal.
 */
export function estimateReactionTime(input = {}) {
  const { fen, uci, lines } = input ?? {};
  if (typeof fen !== 'string' || fen.length > 200 || fen.trim().split(/\s+/).length !== 6
    || typeof uci !== 'string' || !UCI.test(uci)) return neutral('Position ou coup invalide');
  let board;
  try { board = new Chess(fen.trim()); } catch { return neutral('Position ou coup invalide'); }
  const opposingKing = board.board().flat().find((piece) => piece?.type === 'k' && piece.color !== board.turn());
  if (opposingKing && board.isAttacked(opposingKing.square, board.turn())) return neutral('Position ou coup invalide');
  const moves = board.moves({ verbose: true });
  const legalMoves = new Map(moves.map((move) => [uciOf(move), move]));
  const selected = legalMoves.get(uci);
  if (!selected) return neutral('Position ou coup invalide');
  if (moves.length === 1) return { targetMs: 900, level: 'Forcé', reason: 'Seul coup légal' };
  if (selected.san.endsWith('#')) return { targetMs: 1200, level: 'Simple', reason: 'Mat immédiat' };
  const gap = bestGap(lines, legalMoves, board.fen());
  if (gap === null) return neutral();

  const inCheck = board.isCheck();
  const tacticalOptions = moves.filter((move) => move.captured || move.promotion || /[+#]$/.test(move.san)).length;
  // More choices and nearby scores need longer pacing. Tactical features add
  // modest fixed costs; a large best-move gap makes the choice more obvious.
  const optionCost = Math.min(1800, Math.max(0, moves.length - 6) * 45);
  const scoreCost = gap <= 20 ? 2600 : gap <= 60 ? 1600 : gap <= 120 ? 600 : gap >= 200 ? -800 : 0;
  const tacticalCost = Math.min(1800, tacticalOptions * 150)
    + (inCheck ? 1100 : 0) + (selected.captured ? 350 : 0)
    + (selected.promotion ? 900 : 0) + (selected.san.endsWith('+') ? 500 : 0);
  const targetMs = Math.min(10000, Math.max(900, Math.round((1800 + optionCost + scoreCost + tacticalCost) / 100) * 100));
  const level = targetMs <= 2400 ? 'Simple' : targetMs >= 5000 ? 'Complexe' : 'Modéré';
  const reason = selected.promotion ? 'Promotion à examiner' : inCheck ? 'Réponses à un échec'
    : tacticalOptions >= 6 ? 'Nombreuses options tactiques' : gap <= 60 ? 'Meilleurs coups proches'
    : gap >= 200 ? 'Meilleur coup nettement devant' : moves.length >= 30 ? 'Nombreuses options légales' : 'Choix intermédiaire';
  return { targetMs, level, reason };
}
