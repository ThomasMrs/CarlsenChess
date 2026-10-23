import { Chess } from '/extension/vendor/chess.js';

const game = new Chess();
const fenInput = document.querySelector('#fen-input');
const error = document.querySelector('#fixture-error');
const pieceNames = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const glyphs = { wp: '♟', wn: '♞', wb: '♝', wr: '♜', wq: '♛', wk: '♚', bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚' };
let board = document.querySelector('#board-analysis-board');
let flipped = false;
let selected = null;
let focusSquare = 'a8';

function squareOrder() {
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  const ranks = flipped ? '12345678' : '87654321';
  return [...ranks].flatMap((rank) => [...files].map((file) => file + rank));
}

function render() {
  const hadFocus = board.contains(document.activeElement);
  const legalMoves = selected ? game.moves({ square: selected, verbose: true }) : [];
  board.className = `board${flipped ? ' flipped' : ''}`;
  board.setAttribute('aria-label', `Plateau, vue des ${flipped ? 'Noirs' : 'Blancs'}`);
  // This JavaScript property intentionally mirrors the page's MAIN-world API.
  // There is no data-fen attribute or other DOM source for a complete position.
  board.game = { getFEN: () => game.fen() };
  const elements = [];
  for (const [index, square] of squareOrder().entries()) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    const piece = game.get(square);
    const button = document.createElement('button');
    const dark = (square.charCodeAt(0) + Number(square[1])) % 2 === 0;
    button.type = 'button';
    button.className = `square-button${dark ? ' dark' : ''}${selected === square ? ' selected' : ''}${legalMoves.some((move) => move.to === square) ? ' legal' : ''}`;
    button.dataset.square = square;
    button.style.setProperty('--column', column);
    button.style.setProperty('--row', row);
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `${square}, ${piece ? `${pieceNames[piece.type]} ${piece.color === 'w' ? 'blanc' : 'noir'}` : 'case vide'}`);
    button.setAttribute('aria-selected', String(selected === square));
    button.tabIndex = square === focusSquare ? 0 : -1;
    if (index % 8 === 0) button.innerHTML += `<span class="coordinate rank" aria-hidden="true">${square[1]}</span>`;
    if (index >= 56) button.innerHTML += `<span class="coordinate file" aria-hidden="true">${square[0]}</span>`;
    elements.push(button);
    if (piece) {
      const element = document.createElement('div');
      const code = piece.color + piece.type;
      // A piece has exactly the Chess.com piece/color and numeric-square classes.
      element.className = `piece ${code} square-${square.charCodeAt(0) - 96}${square[1]}`;
      element.style.setProperty('--column', column);
      element.style.setProperty('--row', row);
      element.setAttribute('aria-hidden', 'true');
      element.textContent = glyphs[code];
      elements.push(element);
    }
  }
  board.replaceChildren(...elements);
  if (hadFocus) board.querySelector(`[data-square="${focusSquare}"]`)?.focus({ preventScroll: true });
  if (document.activeElement !== fenInput) fenInput.value = game.fen();
  document.querySelector('#current-fen').textContent = game.fen();
  document.querySelector('#position-status').textContent = `Aux ${game.turn() === 'w' ? 'Blancs' : 'Noirs'} de jouer${game.isCheck() ? ' · Échec' : ''} · Vue des ${flipped ? 'Noirs' : 'Blancs'}`;
  document.querySelector('#play-e2e4').disabled = !game.moves({ square: 'e2', verbose: true }).some((move) => move.to === 'e4');
  document.querySelector('#play-e7e5').disabled = !game.moves({ square: 'e7', verbose: true }).some((move) => move.to === 'e5');
}

function play(move) {
  try {
    game.move(move);
    selected = null;
    error.textContent = '';
    render();
  } catch {
    error.textContent = 'Ce coup est illégal dans cette position.';
  }
}

function chooseSquare(square) {
  focusSquare = square;
  const piece = game.get(square);
  if (selected === square) selected = null;
  else if (piece?.color === game.turn()) selected = square;
  else if (selected) {
    const candidate = game.moves({ square: selected, verbose: true }).find((move) => move.to === square);
    if (candidate) {
      play({ from: selected, to: square, ...(candidate.promotion ? { promotion: 'q' } : {}) });
      return;
    }
  }
  render();
}

function bindBoard() {
  board.addEventListener('click', (event) => {
    const square = event.target.closest('[data-square]')?.dataset.square;
    if (square) chooseSquare(square);
  });
  board.addEventListener('focusin', (event) => {
    if (!event.target.dataset.square) return;
    focusSquare = event.target.dataset.square;
    for (const button of board.querySelectorAll('[data-square]')) button.tabIndex = button === event.target ? 0 : -1;
  });
  board.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { selected = null; render(); return; }
    const direction = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (!direction) return;
    event.preventDefault();
    const order = squareOrder();
    const index = order.indexOf(focusSquare);
    const next = index + direction;
    if (next < 0 || next >= 64 || (direction === -1 && index % 8 === 0) || (direction === 1 && index % 8 === 7)) return;
    focusSquare = order[next];
    board.querySelector(`[data-square="${focusSquare}"]`)?.focus();
  });
}

document.querySelector('#play-e2e4').addEventListener('click', () => play({ from: 'e2', to: 'e4' }));
document.querySelector('#play-e7e5').addEventListener('click', () => play({ from: 'e7', to: 'e5' }));
document.querySelector('#reset-game').addEventListener('click', () => { game.reset(); selected = null; error.textContent = ''; render(); });
document.querySelector('#flip-board').addEventListener('click', () => { flipped = !flipped; render(); });
document.querySelector('#replace-board').addEventListener('click', () => {
  const replacement = board.cloneNode(false);
  board.replaceWith(replacement);
  board = replacement;
  bindBoard();
  render();
});
document.querySelector('#load-fen').addEventListener('click', () => {
  const fen = fenInput.value.trim();
  if (fen.split(/\s+/).length !== 6) { error.textContent = 'La FEN doit comporter six champs.'; return; }
  try { game.load(fen); selected = null; error.textContent = ''; render(); }
  catch { error.textContent = 'Cette FEN est invalide.'; }
});

bindBoard();
render();
