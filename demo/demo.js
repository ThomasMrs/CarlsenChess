import { Chess } from '../extension/vendor/chess.js';

const game = new Chess();
const board = document.querySelector('#board');
const fenInput = document.querySelector('#fen-input');
const promotionDialog = document.querySelector('#promotion-dialog');
const names = { p: 'pion', r: 'tour', n: 'cavalier', b: 'fou', q: 'dame', k: 'roi' };
const puzzleFen = '6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1';
let orientation = 'white';
let selected = null;
let focusSquare = 'a8';
let pendingPromotion = null;

function squareOrder() {
  const files = orientation === 'white' ? 'abcdefgh' : 'hgfedcba';
  const ranks = orientation === 'white' ? '87654321' : '12345678';
  return [...ranks].flatMap((rank) => [...files].map((file) => file + rank));
}

function pieceMarkup(piece) {
  return `<svg class="piece ${piece.color === 'w' ? 'white' : 'black'}" viewBox="0 0 64 64" aria-hidden="true"><use href="#piece-${piece.type}"></use></svg>`;
}

function renderBoard() {
  const hadFocus = board.contains(document.activeElement);
  const legalMoves = selected ? game.moves({ square: selected, verbose: true }) : [];
  const history = game.history({ verbose: true });
  const last = history.at(-1);
  board.dataset.carlsenchessOrientation = orientation;
  board.dataset.carlsenchessFen = game.fen();
  board.dataset.turn = game.turn();
  board.dataset.castling = game.fen().split(' ')[2];
  board.setAttribute('aria-label', `Plateau, vue des ${orientation === 'white' ? 'Blancs' : 'Noirs'}. Flèches pour naviguer, Entrée pour jouer.`);
  board.innerHTML = squareOrder().map((square, index) => {
    const piece = game.get(square);
    const isDark = (square.charCodeAt(0) + Number(square[1])) % 2 === 0;
    const isLegal = legalMoves.some((move) => move.to === square);
    const classes = ['square', isDark ? 'dark' : '', selected === square ? 'selected' : '',
      isLegal ? 'legal' : '', isLegal && piece ? 'capture' : '',
      last && [last.from, last.to].includes(square) ? 'last-move' : '',
      piece?.type === 'k' && piece.color === game.turn() && game.isCheck() ? 'in-check' : ''].filter(Boolean).join(' ');
    const label = `${square}${piece ? `, ${names[piece.type]} ${piece.color === 'w' ? 'blanc' : 'noir'}` : ', case vide'}${isLegal ? ', destination autorisée' : ''}`;
    return `<button class="${classes}" type="button" role="gridcell" data-square="${square}" tabindex="${square === focusSquare ? 0 : -1}" aria-label="${label}" aria-selected="${selected === square}">${piece ? pieceMarkup(piece) : ''}${index % 8 === 0 ? `<span class="coordinate rank" aria-hidden="true">${square[1]}</span>` : ''}${index >= 56 ? `<span class="coordinate file" aria-hidden="true">${square[0]}</span>` : ''}</button>`;
  }).join('');
  if (hadFocus) board.querySelector(`[data-square="${focusSquare}"]`)?.focus({ preventScroll: true });
}

function describeGame() {
  const side = game.turn() === 'w' ? 'Blancs' : 'Noirs';
  let title = `Aux ${side} de jouer`;
  let detail = game.history().length ? 'Chaque coup ouvre une nouvelle possibilité.' : 'Toutes les pièces sont en place.';
  if (game.isCheckmate()) {
    title = `Échec et mat · les ${game.turn() === 'w' ? 'Noirs' : 'Blancs'} gagnent`;
    detail = 'La partie est terminée. Rejouez ou explorez une autre position.';
  } else if (game.isStalemate()) {
    title = 'Partie nulle · pat';
    detail = 'Le joueur au trait ne dispose d’aucun coup légal.';
  } else if (game.isDraw()) {
    title = 'Partie nulle';
    detail = 'La position remplit une condition de nullité.';
  } else if (game.isCheck()) detail = `Le roi ${game.turn() === 'w' ? 'blanc' : 'noir'} est en échec.`;
  document.querySelector('#game-status').textContent = title;
  document.querySelector('#game-detail').textContent = detail;
  document.querySelector('#board-hint').textContent = game.isGameOver() ? 'Partie terminée.' : selected ? `Pièce en ${selected} sélectionnée. Choisissez sa destination.` : `Sélectionnez une pièce ${game.turn() === 'w' ? 'blanche' : 'noire'}.`;
  const topColor = orientation === 'white' ? 'b' : 'w';
  document.querySelector('#top-player-name').textContent = topColor === 'b' ? 'Pièces noires' : 'Pièces blanches';
  document.querySelector('#bottom-player-name').textContent = topColor === 'b' ? 'Pièces blanches' : 'Pièces noires';
  for (const [id, color] of [['top-player-status', topColor], ['bottom-player-status', topColor === 'w' ? 'b' : 'w']]) {
    const element = document.getElementById(id);
    const active = color === game.turn() && !game.isGameOver();
    element.textContent = game.isGameOver() ? 'Terminé' : active ? 'À vous' : 'En attente';
    element.classList.toggle('active', active);
  }
  const avatars = document.querySelectorAll('.player-avatar');
  avatars[0].classList.toggle('light-avatar', topColor === 'w');
  avatars[0].textContent = topColor === 'w' ? '♔' : '♚';
  avatars[1].classList.toggle('light-avatar', topColor === 'b');
  avatars[1].textContent = topColor === 'b' ? '♔' : '♚';
}

function renderHistory() {
  const moves = game.history({ verbose: true });
  const rows = [];
  for (const [index, move] of moves.entries()) {
    const moveNumber = move.before.split(' ')[5];
    if (move.color === 'w' || !rows.length) rows.push({ number: moveNumber, white: '', black: '' });
    rows.at(-1)[move.color === 'w' ? 'white' : 'black'] = `<span class="move-san${index === moves.length - 1 ? ' latest' : ''}">${move.san}</span>`;
  }
  document.querySelector('#move-history').innerHTML = rows.map((row) => `<li><span class="move-number">${row.number}.</span>${row.white || '<span>…</span>'}${row.black || '<span></span>'}</li>`).join('');
  document.querySelector('#history-empty').hidden = moves.length > 0;
  document.querySelector('#move-count').textContent = `${moves.length} ${moves.length > 1 ? 'coups' : 'coup'}`;
  document.querySelector('#undo-move').disabled = moves.length === 0;
  const scroller = document.querySelector('.moves-scroll');
  scroller.scrollTop = scroller.scrollHeight;
}

function render() {
  renderBoard();
  describeGame();
  renderHistory();
  if (document.activeElement !== fenInput) fenInput.value = game.fen();
  document.querySelector('#fen-error').textContent = '';
}

function playMove(move) {
  try {
    game.move(move);
    selected = null;
    focusSquare = move.to;
    render();
  } catch { document.querySelector('#board-hint').textContent = 'Ce coup n’est pas autorisé. Choisissez une case indiquée.'; }
}

function chooseSquare(square) {
  focusSquare = square;
  if (game.isGameOver() || pendingPromotion) return;
  const piece = game.get(square);
  if (selected === square) selected = null;
  else if (piece?.color === game.turn()) selected = square;
  else if (selected) {
    const candidate = game.moves({ square: selected, verbose: true }).find((move) => move.to === square);
    if (candidate?.promotion) {
      pendingPromotion = { from: selected, to: square };
      promotionDialog.returnValue = 'cancel';
      promotionDialog.showModal();
      return;
    }
    if (candidate) { playMove({ from: selected, to: square }); return; }
  }
  renderBoard();
  describeGame();
}

board.addEventListener('click', (event) => {
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (square) chooseSquare(square);
});

board.addEventListener('focusin', (event) => {
  if (!event.target.dataset.square) return;
  focusSquare = event.target.dataset.square;
  for (const button of board.querySelectorAll('button')) button.tabIndex = button === event.target ? 0 : -1;
});

board.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { selected = null; renderBoard(); describeGame(); return; }
  const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
  if (!(event.key in directions)) return;
  event.preventDefault();
  const order = squareOrder();
  const current = order.indexOf(focusSquare);
  const next = current + directions[event.key];
  if (next < 0 || next > 63 || (event.key === 'ArrowLeft' && current % 8 === 0) || (event.key === 'ArrowRight' && current % 8 === 7)) return;
  focusSquare = order[next];
  board.querySelector(`[data-square="${focusSquare}"]`)?.focus();
});

promotionDialog.addEventListener('close', () => {
  const move = pendingPromotion;
  pendingPromotion = null;
  if (move && /^[qrbn]$/.test(promotionDialog.returnValue)) playMove({ ...move, promotion: promotionDialog.returnValue });
  board.querySelector(`[data-square="${focusSquare}"]`)?.focus();
});

document.querySelector('#new-game').addEventListener('click', () => { game.reset(); selected = null; render(); });
document.querySelector('#flip-board').addEventListener('click', () => { orientation = orientation === 'white' ? 'black' : 'white'; render(); });
document.querySelector('#undo-move').addEventListener('click', () => { game.undo(); selected = null; render(); });
document.querySelector('#load-puzzle').addEventListener('click', () => { game.load(puzzleFen); selected = null; render(); document.querySelector('#game-detail').textContent = 'Les Blancs jouent. Trouvez le mat en un coup.'; });
document.querySelector('#load-fen').addEventListener('click', () => {
  const fen = fenInput.value.trim();
  if (fen.split(/\s+/).length !== 6) { document.querySelector('#fen-error').textContent = 'Saisissez une FEN complète comportant six champs.'; return; }
  try { game.load(fen); selected = null; render(); } catch { document.querySelector('#fen-error').textContent = 'Cette FEN n’est pas une position valide. Vérifiez ses six champs.'; }
});

render();
